import { useEffect, useState } from "react";

function App() {
  const [aesFile, setAesFile] = useState(null);
  const [dispatchFile, setDispatchFile] = useState(null);
  const [scheduleFile, setScheduleFile] = useState(null);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [condition, setCondition] = useState("RUNNER");
  const [titleStatus, setTitleStatus] = useState("TITLE");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");

  const boxStyle = {
    border: "2px dashed #888",
    padding: "25px",
    marginBottom: "15px",
    textAlign: "center",
    background: "#fafafa",
  };

  useEffect(() => {
    checkScheduleStatus();
  }, []);

  const checkScheduleStatus = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/schedule-status`);
      const data = await response.json();
      setScheduleSaved(data.saved);
    } catch {
      setScheduleSaved(false);
    }
  };

  const handleDrop = (e, type) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];

    if (type === "aes") setAesFile(file);
    if (type === "dispatch") setDispatchFile(file);
    if (type === "schedule") setScheduleFile(file);
  };

  const saveSchedule = async () => {
    if (!scheduleFile) {
      alert("Choose a vessel schedule first");
      return;
    }

    setMessage("Saving schedule...");

    const formData = new FormData();
    formData.append("schedule", scheduleFile);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/save-schedule`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Error saving schedule");
        return;
      }

      setScheduleSaved(true);
      setMessage(data.message || "Schedule saved");
    } catch (err) {
      console.error(err);
      setMessage("Backend not running");
    }
  };

  const processFiles = async () => {
    setMessage("Processing...");
    setResult(null);

    const formData = new FormData();

    if (aesFile) formData.append("aes", aesFile);
    if (dispatchFile) formData.append("dispatch", dispatchFile);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Error processing files");
        return;
      }

      setResult({
        ...data,
        condition: condition || "RUNNER",
        titleStatus: titleStatus || "TITLE",
      });

      setMessage("Done");
    } catch (err) {
      console.error(err);
      setMessage("Backend not running");
    }
  };

  const downloadPDF = async () => {
  if (!result) return;
  // ===== VIN VALIDATION =====
const vin = (result.vin || "").trim();

if (!vin) {
  const proceed = window.confirm(
    "⚠ WARNING:\n\nVIN is missing.\n\nDo you want to continue?"
  );
  if (!proceed) return;
}

if (vin && vin.length !== 17) {
  const proceed = window.confirm(
    `⚠ WARNING:\n\nVIN should be 17 characters.\nCurrent VIN: ${vin}\n\nDo you want to continue?`
  );
  if (!proceed) return;
}

  const pod = (result.portOfDischarge || "").toUpperCase();
  const country = (result.consigneeCountry || "").toUpperCase();

  const portToCountry = {
    LAGOS: "NIGERIA",
    TEMA: "GHANA",
    COTONOU: "BENIN",
    LOME: "TOGO",
  };

  // Reverse lookup: country → correct port
  const countryToPort = {
    NIGERIA: "LAGOS",
    GHANA: "TEMA",
    BENIN: "COTONOU",
    TOGO: "LOME",
  };

  const expectedCountry = portToCountry[pod];
  const correctPort = countryToPort[country];

  if (expectedCountry && country && expectedCountry !== country) {
    const shouldFix = window.confirm(
      `⚠ WARNING:\n\nConsignee country is ${country}, but destination is ${pod}.\n\nCorrect destination should be: ${correctPort}\n\nClick OK to automatically fix destination.\nClick Cancel to keep as-is.`
    );

    if (shouldFix && correctPort) {
      const updated = {
        ...result,
        portOfDischarge: correctPort,
      };

      setResult(updated);
      result.portOfDischarge = correctPort;
    }
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}/generate-pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(result),
  });

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${result.referenceNumber || "dock-receipt"} DR.pdf`;
  a.click();
};

  const excelColumn = result
    ? [
        result.bookingNumber,
        result.referenceNumber,
        result.exporterName,
        result.exporterAddress,
        result.exporterCity,
        result.exporterState,
        result.exporterZip,
        result.exporterCountry,
        result.consigneeName,
        result.consigneeAddress,
        result.consigneeCity,
        result.consigneeCountry,
        result.vehicleType,
        result.weightKgs,
        result.vehicleYearMakeModel,
        result.vin,
        result.value,
        result.aesItn,
        result.portOfLoading,
        result.portOfDischarge,
        result.vessel,
        result.voyage,
        result.cutoffDate,
        result.sailDate,
        result.arrivalDate,
        result.pickupName,
        result.pickupAddress,
        result.pickupCity,
        result.pickupState,
        result.pickupZip,
        result.deliveryName,
        result.deliveryAddress,
        result.deliveryCity,
        result.deliveryState,
        result.deliveryZip,
        result.condition,
        result.titleStatus,
      ].join("\n")
    : "";

  const copyExcelColumn = async () => {
    await navigator.clipboard.writeText(excelColumn);
    alert("Copied Excel column");
  };

  const updateField = (key, value) => {
    setResult({
      ...result,
      [key]: value,
    });
  };

  return (
    <div style={{ padding: "30px", fontFamily: "Arial" }}>
      <h1>Dock Receipt Generator</h1>

      <div style={{ marginBottom: "25px", padding: "15px", border: "1px solid #ccc" }}>
  <h2>Search Saved Shipments</h2>

  <input
    placeholder="Search VIN or Reference #"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    style={{ padding: "8px", width: "280px", marginRight: "10px" }}
  />

  <button onClick={handleSearch} style={{ padding: "8px 15px" }}>
    Search
  </button>

  <ul>
    {results.map((r, i) => (
      <li key={i}>
        {r.referenceNumber} - {r.vin}
      </li>
    ))}
  </ul>
</div>

      <h2>Saved Vessel Schedule</h2>

      <p>
        <strong>Schedule Status:</strong>{" "}
        {scheduleSaved ? "Saved schedule is loaded" : "No saved schedule yet"}
      </p>

      <div
        style={boxStyle}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e, "schedule")}
      >
        <strong>Update / Replace Vessel Schedule</strong>
        <br />
        {scheduleFile ? scheduleFile.name : "Drag master schedule Excel here"}
        <br />
        <br />
        <input type="file" onChange={(e) => setScheduleFile(e.target.files[0])} />
      </div>

      <button style={{ padding: "8px 15px", marginBottom: "25px" }} onClick={saveSchedule}>
        Save / Replace Vessel Schedule
      </button>

      <h2>Daily Files</h2>

      <div
        style={boxStyle}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e, "aes")}
      >
        <strong>AES PDF</strong>
        <br />
        {aesFile ? aesFile.name : "Drag AES PDF here"}
        <br />
        <br />
        <input type="file" onChange={(e) => setAesFile(e.target.files[0])} />
      </div>

      <div
        style={boxStyle}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e, "dispatch")}
      >
        <strong>Dispatch PDF</strong>
        <br />
        {dispatchFile ? dispatchFile.name : "Drag Dispatch PDF here"}
        <br />
        <br />
        <input type="file" onChange={(e) => setDispatchFile(e.target.files[0])} />
      </div>

      <div style={{ marginTop: "20px" }}>
        <strong>Condition of Vehicle:</strong>
        <br />
        <label>
          <input
            type="radio"
            name="condition"
            value="RUNNER"
            checked={condition === "RUNNER"}
            onChange={(e) => setCondition(e.target.value)}
          />
          Runner
        </label>
        <br />
        <label>
          <input
            type="radio"
            name="condition"
            value="NONRUNNER"
            checked={condition === "NONRUNNER"}
            onChange={(e) => setCondition(e.target.value)}
          />
          Nonrunner
        </label>
        <br />
        <label>
          <input
            type="radio"
            name="condition"
            value="FORKLIFT"
            checked={condition === "FORKLIFT"}
            onChange={(e) => setCondition(e.target.value)}
          />
          Forklift
        </label>
      </div>

      <div style={{ marginTop: "20px" }}>
        <strong>Title Status:</strong>
        <br />
        <label>
          <input
            type="radio"
            name="title"
            value="TITLE"
            checked={titleStatus === "TITLE"}
            onChange={(e) => setTitleStatus(e.target.value)}
          />
          Title
        </label>
        <br />
        <label>
          <input
            type="radio"
            name="title"
            value="NO TITLE"
            checked={titleStatus === "NO TITLE"}
            onChange={(e) => setTitleStatus(e.target.value)}
          />
          No Title
        </label>
      </div>

      <button style={{ marginTop: "25px", padding: "10px 20px" }} onClick={processFiles}>
        Process Files
      </button>

      {message && (
        <p>
          <strong>Status:</strong> {message}
        </p>
      )}

      {result && (
        <div style={{ marginTop: "30px" }}>
          <h2>Manual Override / Edit Before PDF</h2>

          <button onClick={copyExcelColumn} style={{ marginBottom: "10px", padding: "8px 15px" }}>
            Copy Excel Column
          </button>

          <button
            onClick={downloadPDF}
            style={{ marginBottom: "10px", marginLeft: "10px", padding: "8px 15px" }}
          >
            Generate / Download DR PDF
          </button>

          <h3>Excel Column</h3>
          <textarea
            value={excelColumn}
            readOnly
            style={{
              width: "100%",
              height: "140px",
              fontFamily: "Consolas",
              fontSize: "14px",
              marginBottom: "25px",
            }}
          />

          <h3>Edit Fields</h3>

          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "8px", maxWidth: "850px" }}>
            {Object.keys(result).map((key) => (
              <div key={key} style={{ display: "contents" }}>
                <label style={{ fontWeight: "bold" }}>{key}</label>
                <input
                  value={result[key] || ""}
                  onChange={(e) => updateField(key, e.target.value)}
                  style={{ padding: "6px", fontSize: "14px" }}
                />
              </div>
            ))}
          </div>

          <button onClick={downloadPDF} style={{ marginTop: "25px", padding: "10px 20px" }}>
            Generate DR With Manual Overrides
          </button>
        </div>
      )}
    </div>
  );
}

export default App;