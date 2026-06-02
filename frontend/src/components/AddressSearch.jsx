const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

import { useEffect, useRef, useState } from "react";

export default function AddressSearch({
  label,
  type,
  value,
  onSelect,
}) {
  const [search, setSearch] = useState(value || "");
  const [results, setResults] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  // Track programmatic fills so we don't fire a live-search dropdown for them
  const suppressSearch = useRef(false);

  // Keep the search bar in sync when the parent sets a value programmatically
  // (e.g. buyer receipt auto-fill or any other form population)
  useEffect(() => {
    suppressSearch.current = true;
    setSearch(value || "");
    setResults([]);
  }, [value]);

  const [newAddress, setNewAddress] = useState({
    companyName: "",
    contactName: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "UNITED STATES",
    phone: "",
    email: "",
    type: type || "general",
  });

  useEffect(() => {
    // Skip the auto-search when the change came from a programmatic fill
    if (suppressSearch.current) {
      suppressSearch.current = false;
      return;
    }

    if (!search || search.length < 2) {
      setResults([]);
      return;
    }

    const delay = setTimeout(() => {
      fetchResults();
    }, 300);

    return () => clearTimeout(delay);
  }, [search]);

  const fetchResults = async () => {
    const res = await fetch(
      `${API}/api/address-book?search=${encodeURIComponent(
        search
      )}${type ? `&type=${type}` : ""}`
    );

    const data = await res.json();
    setResults(data);
  };

  const selectAddress = (item) => {
    setSearch(item.companyName);
    setResults([]);
    onSelect(item);
  };

  const saveNewAddress = async () => {
    if (!newAddress.companyName) {
      alert("Company/name is required");
      return;
    }

    const res = await fetch(`${API}/api/address-book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newAddress),
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Failed to save address");
      return;
    }

    setShowAdd(false);
    selectAddress(data);
  };

  return (
    <div style={{ position: "relative", marginBottom: "18px" }}>
      <label>
        <strong>{label}</strong>
      </label>

      <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
        <input
          value={search}
          placeholder={`Search ${label}...`}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />

        <button
          type="button"
          onClick={() => {
            setShowAdd(!showAdd);
            setNewAddress({
              ...newAddress,
              companyName: search,
              type: type || "general",
            });
          }}
        >
          + Add New
        </button>
      </div>

      {results.length > 0 && (
        <div
          style={{
            position: "absolute",
            zIndex: 30,
            left: 0,
            right: 0,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            marginTop: "4px",
            maxHeight: "260px",
            overflow: "auto",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {results.map((item) => {
            const location = [item.city, item.state].filter(Boolean).join(", ");
            return (
              <div
                key={item._id}
                onMouseDown={() => selectAddress(item)}
                style={{
                  padding: "9px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-muted)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                    {item.companyName}
                  </div>
                  {location && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {location}
                    </div>
                  )}
                </div>
                {item.country && (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap",
                    background: "var(--bg-panel)", borderRadius: 4, padding: "2px 6px",
                    border: "1px solid var(--border-muted)", flexShrink: 0 }}>
                    {item.country}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <div
          style={{
            marginTop: "12px",
            padding: "14px",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            background: "var(--bg-panel)",
          }}
        >
          <h4 style={{ marginTop: 0 }}>Add New {label}</h4>

          <input
            placeholder="Company / Name"
            value={newAddress.companyName}
            onChange={(e) =>
              setNewAddress({
                ...newAddress,
                companyName: e.target.value,
              })
            }
          />

          <input
            placeholder="Contact Name"
            value={newAddress.contactName}
            onChange={(e) =>
              setNewAddress({
                ...newAddress,
                contactName: e.target.value,
              })
            }
          />

          <input
            placeholder="Address"
            value={newAddress.address}
            onChange={(e) =>
              setNewAddress({
                ...newAddress,
                address: e.target.value,
              })
            }
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 140px", gap: "8px" }}>
            <input
              placeholder="City"
              value={newAddress.city}
              onChange={(e) =>
                setNewAddress({
                  ...newAddress,
                  city: e.target.value,
                })
              }
            />

            <input
              placeholder="State"
              value={newAddress.state}
              onChange={(e) =>
                setNewAddress({
                  ...newAddress,
                  state: e.target.value,
                })
              }
            />

            <input
              placeholder="Zip"
              value={newAddress.postalCode}
              onChange={(e) =>
                setNewAddress({
                  ...newAddress,
                  postalCode: e.target.value,
                })
              }
            />
          </div>

          <input
            placeholder="Country"
            value={newAddress.country}
            onChange={(e) =>
              setNewAddress({
                ...newAddress,
                country: e.target.value,
              })
            }
          />

          <input
            placeholder="Phone"
            value={newAddress.phone}
            onChange={(e) =>
              setNewAddress({
                ...newAddress,
                phone: e.target.value,
              })
            }
          />

          <input
            placeholder="Email"
            value={newAddress.email}
            onChange={(e) =>
              setNewAddress({
                ...newAddress,
                email: e.target.value,
              })
            }
          />

          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button type="button" onClick={saveNewAddress}>
              Save + Select
            </button>

            <button type="button" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}