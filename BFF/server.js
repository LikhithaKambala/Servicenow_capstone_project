import express, { json } from "express";
import { randomBytes, createHash } from "crypto";
import axios from "axios";
import cookieParser from "cookie-parser";
import { stringify } from "qs";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

const REDIRECT_URI = process.env.REDIRECT_URI;
const SN_INTANCE = process.env.SN_INTANCE;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const authEndpoint = `${SN_INTANCE}/oauth_auth.do`;
const tokenEndpoint = `${SN_INTANCE}/oauth_token.do`;

// in real-life we would use Redis here
const tokenStore = new Map();

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

app.get("/auth/login", (req, res) => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const sessionId = base64url(randomBytes(24));

  tokenStore.set(sessionId, {
    code_verifier: verifier,
    state: state,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  res.cookie("sid", sessionId, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: Date.now() + 15 * 60 * 1000,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: state,
  });

  res.redirect(`${authEndpoint}?${params.toString()}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  const sid = req.cookies.sid;
  const session = tokenStore.get(sid);

  if (!session) return res.status(400).send("Bad session");
  if (session.state !== state) return res.status(400).send("State Mismatch");

  const data = {
    grant_type: "authorization_code",
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: session.code_verifier,
    client_secret: CLIENT_SECRET,
  };

  const resp = await axios.post(tokenEndpoint, stringify(data), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  tokenStore.set(sid, { ...session, ...resp.data, obtained_at: Date.now() });
  res.redirect("http://localhost:5173/");
});

app.get("/auth/status", (req, res) => {
  const sid = req.cookies.sid;
  const session = tokenStore.get(sid);
  if (!session || !session.access_token)
    return res.json({ authenticated: false });
  return res.json({ authenticated: true });
});

app.get("/auth/logout", (req, res) => {
  const sid = req.cookies.sid;
  if (sid) {
    tokenStore.delete(sid);
    res.clearCookie("sid", { path: "/" });
  }
  res.json({ ok: true });
});

app.get("/api/incidents", async (req, res) => {
  const sid = req.cookies.sid;
  const session = tokenStore.get(sid);

  if (!session.access_token) return res.status(401).send("Not authenticated");

  try {
    const r = await axios.get(
      `${SN_INTANCE}/api/now/table/incident?sysparm_display_value=true&sysparm_fields=sys_id%2Cnumber%2Cstate%2Cpriority%2Cshort_description&sysparm_limit=100`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }
    );
    res.json(r.data);
  } catch (e) {
    if (e.response.status == 401 && session.refresh_token) {
      const data = {
        grant_type: "refresh_token",
        refresh_token: session.refresh_token,
        client_id: CLIENT_ID,
      };

      try {
        const refresh = await axios.post(tokenEndpoint, stringify(data), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        tokenStore.set(sid, { ...session, ...refresh.data });

        const retry = await axios.get(
          `${SN_INTANCE}/api/now/table/incident?sysparm_display_value=true&sysparm_fields=number%2Cstate%2Cpriority%2Cshort_description&sysparm_limit=100`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        );
        res.json(r.data);
      } catch (e) {
        res.status(401).send("Session Expired");
      }
      res.status(e.response.status || 500).send("Upstream error");
    }
  }
});

app.delete("/api/incidents/:id", async (req, res) => {
  const sid = req.cookies.sid;
  const session = tokenStore.get(sid);

  if (!session || !session.access_token) {
    return res.status(401).send("Not authenticated");
  }

  const incidentId = req.params.id;

  try {
    const response = await axios.delete(
      `${SN_INTANCE}/api/now/table/incident/${incidentId}`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    // ServiceNow returns 204 No Content on success
    if (response.status === 204) {
      res.json({ ok: true, message: `Incident ${incidentId} deleted` });
    } else {
      res.status(response.status).json({ error: "Unexpected response" });
    }
  } catch (e) {
    if (e.response) {
      res.status(e.response.status).json({
        error: e.response.data || "Error deleting incident",
      });
    } else {
      res.status(500).json({ error: "Server error" });
    }
  }
});
app.post("/api/incidents", async (req, res) => {
  const sid = req.cookies.sid;
  const session = tokenStore.get(sid);

  if (!session || !session.access_token) {
    return res.status(401).send("Not authenticated");
  }

  // Ensure priority is a number
  const payload = {
    ...req.body,
    priority: Number(req.body.priority),
  };

  try {
    const r = await axios.post(
      `${SN_INTANCE}/api/now/table/incident`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Pass ServiceNow response back to client
    return res.status(r.status).json(r.data);
  } catch (e) {
    // If token expired, try refresh -> retry once
    if (e.response?.status === 401 && session.refresh_token) {
      try {
        const data = {
          grant_type: "refresh_token",
          refresh_token: session.refresh_token,
          client_id: CLIENT_ID,
        };

        const refresh = await axios.post(tokenEndpoint, stringify(data), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        tokenStore.set(sid, { ...session, ...refresh.data, obtained_at: Date.now() });

        // retry create with new token
        const retry = await axios.post(
          `${SN_INTANCE}/api/now/table/incident`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${refresh.data.access_token}`,
              "Content-Type": "application/json",
            },
          }
        );

        return res.status(retry.status).json(retry.data);
      } catch (refreshErr) {
        return res.status(401).send("Session Expired");
      }
    }

    if (e.response) {
      return res.status(e.response.status).json(e.response.data);
    }
    return res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/incidents/:id", async (req, res) => {
  const sid = req.cookies.sid;
  const session = tokenStore.get(sid);

  if (!session || !session.access_token) {
    return res.status(401).send("Not authenticated");
  }

  const incidentId = req.params.id;
  
  // Ensure priority is a number
  const payload = {
    ...req.body,
    priority: Number(req.body.priority),
  };

  try {
    const r = await axios.put(
      `${SN_INTANCE}/api/now/table/incident/${incidentId}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Fetch the updated incident with display values to return to client
    const getUpdated = await axios.get(
      `${SN_INTANCE}/api/now/table/incident/${incidentId}?sysparm_display_value=true&sysparm_fields=sys_id%2Cnumber%2Cstate%2Cpriority%2Cshort_description`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }
    );

    return res.status(200).json({ result: getUpdated.data.result[0] || getUpdated.data.result });
  } catch (e) {
    // If unauthorized, try to refresh and retry once
    if (e.response?.status === 401 && session.refresh_token) {
      try {
        const data = {
          grant_type: "refresh_token",
          refresh_token: session.refresh_token,
          client_id: CLIENT_ID,
        };

        const refresh = await axios.post(tokenEndpoint, stringify(data), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        tokenStore.set(sid, { ...session, ...refresh.data, obtained_at: Date.now() });

        const retry = await axios.put(
          `${SN_INTANCE}/api/now/table/incident/${incidentId}`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${refresh.data.access_token}`,
              "Content-Type": "application/json",
            },
          }
        );

        // Fetch the updated incident with display values
        const getUpdated = await axios.get(
          `${SN_INTANCE}/api/now/table/incident/${incidentId}?sysparm_display_value=true&sysparm_fields=sys_id%2Cnumber%2Cstate%2Cpriority%2Cshort_description`,
          {
            headers: { Authorization: `Bearer ${refresh.data.access_token}` },
          }
        );

        return res.status(200).json({ result: getUpdated.data.result[0] || getUpdated.data.result });
      } catch (refreshErr) {
        return res.status(401).send("Session Expired");
      }
    }

    if (e.response) {
      return res.status(e.response.status).json(e.response.data);
    }
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(3001, () => console.log("BFF on 3001"));