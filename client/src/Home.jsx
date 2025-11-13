import {
  Stack,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
} from "@mui/material";
import { useContext, useEffect, useState } from "react";
import { AuthContext } from "./AuthProvider";
import axios from "axios";
import styles from "./Home.module.css";

export default function Home() {
  const { isLogged } = useContext(AuthContext);
  const [incidents, setIncidents] = useState([]);
  const [formData, setFormData] = useState({
    description: "",
    state: "",
    urgency: "",
    impact: "",
    priority: "",
  });
  const [editingId, setEditingId] = useState(null); // track sys_id being edited
  const [createOpen, setCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Calculate priority based on urgency and impact
  function calculatePriority(urgency, impact) {
    const u = parseInt(urgency || "0", 10);
    const i = parseInt(impact || "0", 10);
    if (u === 0 || i === 0) return "";
    if (u === 1 && i === 1) return "1";
    if (u + i <= 4) return "2";
    if (u + i <= 5) return "3";
    return "4";
  }

  const onDelete = async (sys_id) => {
    try {
      await axios.delete(`http://localhost:3001/api/incidents/${sys_id}`, {
        withCredentials: true,
      });
      setIncidents(incidents.filter((inc) => inc.sys_id !== sys_id));
      alert("Incident deleted successfully");
    } catch (err) {
      console.error("Failed to delete incident:", err);
      alert("Error deleting incident");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        // UPDATE existing incident
        const res = await axios.put(
          `http://localhost:3001/api/incidents/${editingId}`,
          {
            short_description: formData.description,
            state: formData.state,
            urgency: formData.urgency,
            impact: formData.impact,
          },
          { withCredentials: true }
        );

        // Handle both possible response structures from ServiceNow
        const updatedIncident = res.data.result || res.data;
        
        setIncidents((prev) =>
          prev.map((inc) =>
            inc.sys_id === editingId 
              ? { ...inc, ...updatedIncident }
              : inc
          )
        );
      } else {
        // CREATE new incident
        const res = await axios.post(
          "http://localhost:3001/api/incidents",
          {
            short_description: formData.description,
            state: formData.state,
            urgency: formData.urgency,
            impact: formData.impact,
          },
          { withCredentials: true }
        );
        setIncidents((prev) => [res.data.result, ...prev]);
      }

      setSuccessMsg(editingId ? "Incident updated successfully" : "Incident created successfully");
      // reset form
      setFormData({ description: "", state: "", urgency: "", impact: "", priority: "" });
      setEditingId(null);
      setCreateOpen(false);
    } catch (err) {
      console.error("Failed to save incident:", err);
      const errorMessage = err.response?.data?.error || "Error saving incident";
      setErrorMsg(errorMessage);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Keep priority as string for Select compatibility
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const onEdit = (incident) => {
    console.log("Editing incident:", incident);
    
    setFormData({
      description: incident.short_description || "",
      state: incident.state || "",
      urgency: incident.urgency ? String(incident.urgency) : "",
      impact: incident.impact ? String(incident.impact) : "",
      priority: incident.priority ? String(incident.priority) : "",
    });
    setEditingId(incident.sys_id);
    setCreateOpen(true);
  };

  useEffect(() => {
    async function fetchData() {
      if (isLogged) {
        const incidentList = await axios.get(
          "http://localhost:3001/api/incidents",
          { withCredentials: true }
        );
        setIncidents(incidentList.data.result);
      }
    }
    fetchData();
  }, [isLogged]);

  return (
    <>
      {isLogged && incidents ? (
        <>
          <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>{editingId ? "Edit Incident" : "Create New Incident"}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 2 }}>
                <TextField
                  label="Description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  multiline
                  rows={1}
                  fullWidth
                />
                <FormControl fullWidth>
                  <InputLabel>State</InputLabel>
                  <Select
                    name="state"
                    value={formData.state}
                    onChange={handleChange}
                    label="State"
                  >
                    <MenuItem value="New">New</MenuItem>
                    <MenuItem value="In Progress">In Progress</MenuItem>
                    <MenuItem value="Resolved">Resolved</MenuItem>
                    <MenuItem value="Closed">Closed</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Urgency</InputLabel>
                  <Select
                    name="urgency"
                    value={formData.urgency}
                    onChange={handleChange}
                    label="Urgency"
                  >
                    <MenuItem value="1">1 - High</MenuItem>
                    <MenuItem value="2">2 - Medium</MenuItem>
                    <MenuItem value="3">3 - Low</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Impact</InputLabel>
                  <Select
                    name="impact"
                    value={formData.impact}
                    onChange={handleChange}
                    label="Impact"
                  >
                    <MenuItem value="1">1 - High</MenuItem>
                    <MenuItem value="2">2 - Medium</MenuItem>
                    <MenuItem value="3">3 - Low</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label="Priority (Auto-calculated)"
                  value={calculatePriority(formData.urgency, formData.impact) ? `${calculatePriority(formData.urgency, formData.impact)} - ${
                    calculatePriority(formData.urgency, formData.impact) === "1" ? "Critical" :
                    calculatePriority(formData.urgency, formData.impact) === "2" ? "High" :
                    calculatePriority(formData.urgency, formData.impact) === "3" ? "Medium" : "Low"
                  }` : ""}
                  fullWidth
                  disabled
                  variant="outlined"
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setCreateOpen(false); setEditingId(null); }}>Cancel</Button>
              <Button variant="contained" onClick={handleSubmit}>{editingId ? "Update" : "Create"}</Button>
            </DialogActions>
          </Dialog>

          <Stack spacing={3}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="h5">Incident Records:</Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => {
                  setCreateOpen(true);
                  setEditingId(null);
                  setFormData({ description: "", state: "", urgency: "", impact: "", priority: "" });
                }}
              >
                + Create Incident
              </Button>
            </Stack>

            <Grid container spacing={3}>
            {incidents.map((inc) => (
              <Grid key={inc.sys_id} item xs={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card sx={{ width: 300, height: 200 }}>
                  <CardContent>
                    <Typography variant="h6">
                      Incident #: {inc.number}
                    </Typography>
                    <Typography variant="body2">
                      Description: {inc.short_description}
                    </Typography>
                    <Typography variant="body2">State: {inc.state}</Typography>
                    <Typography variant="body2">
                      Priority: {inc.priority}
                    </Typography>
                    <Button
                      sx={{ mt: 1 }}
                      variant="contained"
                      color="success"
                      onClick={() => onEdit(inc)}
                    >
                      Edit
                    </Button>
                    <Button
                      sx={{ mt: 1, mx: 1 }}
                      variant="contained"
                      color="error"
                      onClick={() => onDelete(inc.sys_id)}
                    >
                      Delete
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          </Stack>

          <Snackbar open={!!successMsg} autoHideDuration={4000} onClose={() => setSuccessMsg("")}>
            <Alert severity="success" onClose={() => setSuccessMsg("")}>{successMsg}</Alert>
          </Snackbar>

          <Snackbar open={!!errorMsg} autoHideDuration={6000} onClose={() => setErrorMsg("")}>
            <Alert severity="error" onClose={() => setErrorMsg("")}>{errorMsg}</Alert>
          </Snackbar>
        </>
      ) : (
        <Typography>Please log in</Typography>
      )}
    </>
  );
}