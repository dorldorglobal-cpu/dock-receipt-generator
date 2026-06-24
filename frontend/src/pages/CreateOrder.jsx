import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AddressSearch from "../components/AddressSearch";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function CreateOrder() {
  const navigate = useNavigate();

  // ── Buyer Receipt parsing ──────────────────────────────────────────────
  const [brDragging, setBrDragging]         = useState(false);
  const [brParsing, setBrParsing]           = useState(false);
  const [brResult, setBrResult]             = useState(null);   // parsed data
  const [brFile, setBrFile]                 = useState(null);   // actual file — uploaded after order creation
  const [brCustomerFound, setBrCustomerFound] = useState(null); // true/false/null
  const brInputRef = useRef(null);

  // ── Order Request Form parsing ─────────────────────────────────────────
  const [orfDragging, setOrfDragging]       = useState(false);
  const [orfParsing, setOrfParsing]         = useState(false);
  const [orfResult, setOrfResult]           = useState(null);
  const [orfFile, setOrfFile]               = useState(null);
  const orfInputRef = useRef(null);

  // ── Parse confirmation popup ───────────────────────────────────────────
  const [parsePopup, setParsePopup]         = useState(null); // { data, file, label }
  const [popupType, setPopupType]           = useState("RORO");
  const [popupContainerSize, setPopupContainerSize] = useState("");
  const [popupWarehouse, setPopupWarehouse] = useState(null);
  const [popupCustomerName, setPopupCustomerName] = useState("");
  const [popupCustSuggestions, setPopupCustSuggestions] = useState([]);
  const [popupCustRecord, setPopupCustRecord]     = useState(null);

  // ── Order number lock ─────────────────────────────────────────────────
  const [refLocked, setRefLocked]           = useState(true);

  // ── New customer contact popup ─────────────────────────────────────────
  const [newCustPopup, setNewCustPopup]     = useState(null); // { name, phone, email, defaultPod }
  const [custChoice, setCustChoice]         = useState(null); // null | "new" | "existing"
  const [custSearch, setCustSearch]         = useState("");
  const [custSearchResults, setCustSearchResults] = useState([]);
  const [custSearchLoading, setCustSearchLoading] = useState(false);

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",

    consigneeName: "",
    consigneeAddress: "",
    consigneeCity: "",
    consigneeState: "",
    consigneeZip: "",
    consigneeCountry: "",

    exporterName: "",
    exporterAddress: "",
    exporterCity: "",
    exporterState: "",
    exporterZip: "",
    exporterCountry: "UNITED STATES",

    requestType: "RORO",
    requestDate: new Date().toLocaleString(),
    processedBy: "",

    year: "",
    make: "",
    model: "",
    vin: "",
    color: "",

    pickupLocation: "",
    pickupName: "",
    pickupAddress: "",
    pickupCity: "",
    pickupState: "",
    pickupZip: "",

    deliveryLocation: "",
    deliveryName: "",
    deliveryAddress: "",
    deliveryCity: "",
    deliveryState: "",
    deliveryZip: "",

    contactName: "",
    shippingLine: "",
    pol: "",
    pod: "",
    vessel: "",
    voyage: "",
    cutoffDate: "",
    sailDate: "",
    arrivalDate: "",
    bookingNumber: "",
    containerNumber: "",
    sealNumber: "",
    condition: "Runner",
    titleStatus: "Title",

    buyerName: "",
    lotNumber: "",
    pin: "",

    notes: "",
    source: "USA OFFICE",
  });

  const [message, setMessage] = useState("");
  const [dupOrderId, setDupOrderId] = useState(null);
  const [nextRef, setNextRef] = useState("");
  const [manualRef, setManualRef] = useState("");
  const [custSuggestion, setCustSuggestion] = useState(null); // { _id, companyName, phone, email, defaultPod }

  const [scheduleVessels, setScheduleVessels] = useState([]);
  const [scheduleMatches, setScheduleMatches] = useState([]);
  const [scheduleLooking, setScheduleLooking] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/schedule/vessels`)
      .then(r => r.json()).then(setScheduleVessels).catch(() => {});

    // Fetch next order number
    fetch(`${API}/api/orders/next-ref`)
      .then(r => r.json()).then(d => { setNextRef(d.nextRef); setManualRef(d.nextRef); }).catch(() => {});

    // Pre-fill from AI Assistant
    const aiFields = sessionStorage.getItem("ai_prefill");
    if (aiFields) {
      try {
        const f = JSON.parse(aiFields);
        sessionStorage.removeItem("ai_prefill");
        setForm(prev => ({
          ...prev,
          ...(f.customerName     ? { customerName:      f.customerName     } : {}),
          ...(f.customerPhone    ? { customerPhone:     f.customerPhone    } : {}),
          ...(f.customerEmail    ? { customerEmail:     f.customerEmail    } : {}),
          ...(f.consigneeName    ? { consigneeName:     f.consigneeName    } : {}),
          ...(f.consigneeAddress ? { consigneeAddress:  f.consigneeAddress } : {}),
          ...(f.consigneeCity    ? { consigneeCity:     f.consigneeCity    } : {}),
          ...(f.consigneeState   ? { consigneeState:    f.consigneeState   } : {}),
          ...(f.consigneeZip     ? { consigneeZip:      f.consigneeZip     } : {}),
          ...(f.consigneeCountry ? { consigneeCountry:  f.consigneeCountry } : {}),
          ...(f.exporterName     ? { exporterName:      f.exporterName     } : {}),
          ...(f.exporterAddress  ? { exporterAddress:   f.exporterAddress  } : {}),
          ...(f.exporterCity     ? { exporterCity:      f.exporterCity     } : {}),
          ...(f.exporterState    ? { exporterState:     f.exporterState    } : {}),
          ...(f.exporterZip      ? { exporterZip:       f.exporterZip      } : {}),
          ...(f.exporterCountry  ? { exporterCountry:   f.exporterCountry  } : {}),
          ...(f.year             ? { year:              f.year             } : {}),
          ...(f.make             ? { make:              f.make             } : {}),
          ...(f.model            ? { model:             f.model            } : {}),
          ...(f.vin              ? { vin:               f.vin              } : {}),
          ...(f.color            ? { color:             f.color            } : {}),
          ...(f.buyerName        ? { buyerName:         f.buyerName        } : {}),
          ...(f.lotNumber        ? { lotNumber:         f.lotNumber        } : {}),
          ...(f.pickupName       ? { pickupName:        f.pickupName       } : {}),
          ...(f.pickupAddress    ? { pickupAddress:     f.pickupAddress    } : {}),
          ...(f.pickupCity       ? { pickupCity:        f.pickupCity       } : {}),
          ...(f.pickupState      ? { pickupState:       f.pickupState      } : {}),
          ...(f.pickupZip        ? { pickupZip:         f.pickupZip        } : {}),
          ...(f.deliveryName     ? { deliveryName:      f.deliveryName     } : {}),
          ...(f.deliveryAddress  ? { deliveryAddress:   f.deliveryAddress  } : {}),
          ...(f.deliveryCity     ? { deliveryCity:      f.deliveryCity     } : {}),
          ...(f.deliveryState    ? { deliveryState:     f.deliveryState    } : {}),
          ...(f.deliveryZip      ? { deliveryZip:       f.deliveryZip      } : {}),
          ...(f.vessel           ? { vessel:            f.vessel           } : {}),
          ...(f.voyage           ? { voyage:            f.voyage           } : {}),
          ...(f.bookingNumber    ? { bookingNumber:     f.bookingNumber    } : {}),
          ...(f.pol              ? { pol:               f.pol              } : {}),
          ...(f.pod              ? { pod:               f.pod              } : {}),
          ...(f.cutoffDate       ? { cutoffDate:        f.cutoffDate       } : {}),
          ...(f.sailDate         ? { sailDate:          f.sailDate         } : {}),
          ...(f.notes            ? { notes:             f.notes            } : {}),
        }));
      } catch {}
    }
  }, []);

  // ── Fuzzy customer match warning ─────────────────────────────────────────
  useEffect(() => {
    if (!form.customerName || form.customerName.length < 3) { setCustSuggestion(null); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/address-book?search=${encodeURIComponent(form.customerName)}&type=customer`);
        const data = await res.json();
        if (!data.length) return setCustSuggestion(null);
        const needle = form.customerName.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const c of data) {
          const hay = (c.companyName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const exact = hay === needle;
          const contains = hay.includes(needle) || needle.includes(hay);
          if (!exact && contains && Math.abs(hay.length - needle.length) <= 5) {
            setCustSuggestion(c); return;
          }
        }
        setCustSuggestion(null);
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [form.customerName]);

  const lookupSchedule = async (vessel, pol, pod) => {
    if (!vessel || !pol || !pod) return;
    setScheduleLooking(true);
    try {
      const res = await fetch(
        `${API}/api/schedule/lookup?vessel=${encodeURIComponent(vessel)}&pol=${encodeURIComponent(pol)}&pod=${encodeURIComponent(pod)}`
      );
      const data = await res.json();
      if (data.found) {
        setForm(prev => ({
          ...prev,
          voyage:      data.voyage      || prev.voyage,
          cutoffDate:  data.cutoffDate  || prev.cutoffDate,
          sailDate:    data.sailDate    || prev.sailDate,
          arrivalDate: data.arrivalDate || prev.arrivalDate,
        }));
      }
    } catch {}
    setScheduleLooking(false);
  };

  const update = (key, value) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const decodeVin = async (vin) => {
    if (vin.length !== 17) return;

    try {
      const res = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`
      );

      const data = await res.json();

      const result = data.Results?.[0];

      if (result) {
        setForm((prev) => ({
          ...prev,
          year: result.ModelYear || prev.year,
          make: result.Make || prev.make,
          model: result.Model || prev.model,
        }));
      }
    } catch (err) {
      console.error("VIN decode failed", err);
    }
  };

  // ── POD → default shipping line ──────────────────────────────────────────
  const podToShippingLine = (pod) => {
    if (!pod) return "";
    const p = pod.toUpperCase();
    if (["LAGOS", "COTONOU", "LOME", "DAKAR", "ABIDJAN"].includes(p)) return "SALLAUM";
    if (p === "TEMA") return "ACL";
    return "";
  };

  // ── Country → default POD mapping ────────────────────────────────────────
  const countryToPod = (country) => {
    if (!country) return "";
    const c = country.toUpperCase().trim();
    if (/NIGERIA|^NG$/.test(c))                               return "LAGOS";
    if (/GHANA|^GH$/.test(c))                                 return "TEMA";
    if (/TOGO|^TG$/.test(c))                                  return "LOME";
    if (/BENIN|^BJ$/.test(c))                                 return "COTONOU";
    if (/SENEGAL|^SN$/.test(c))                               return "DAKAR";
    if (/IVORY\s*COAST|C[OÔ]TE.D.IVOIRE|^CI$/.test(c))      return "ABIDJAN";
    if (/SOUTH\s*AFRICA|^ZA$/.test(c))                        return "DURBAN";
    if (/CAMEROON|CAMEROUN|^CM$/.test(c))                     return "DOUALA";
    if (/LIBERIA|^LR$/.test(c))                               return "MONROVIA";
    if (/SIERRA\s*LEONE|^SL$/.test(c))                        return "FREETOWN";
    if (/GUINEA|^GN$/.test(c))                                return "CONAKRY";
    if (/GAMBIA|^GM$/.test(c))                                return "BANJUL";
    if (/ANGOLA|^AO$/.test(c))                                return "LUANDA";
    if (/MALI|^ML$/.test(c))                                  return "DAKAR";
    if (/BURKINA|^BF$/.test(c))                               return "TEMA";
    if (/NIGER|^NE$/.test(c))                                 return "COTONOU";
    return "";
  };

  const selectCustomer = (item) => {
    // Prefer stored defaultPod, fall back to country-derived pod
    const suggestedPod  = item.defaultPod || countryToPod(item.country);
    const suggestedLine = podToShippingLine(suggestedPod);
    setForm((prev) => ({
      ...prev,
      customerName:  item.companyName || "",
      customerPhone: item.phone       || "",
      customerEmail: item.email       || "",
      source:        item.defaultOffice || "USA OFFICE",
      ...(suggestedPod  ? { pod:          suggestedPod  } : {}),
      ...(suggestedLine ? { shippingLine: suggestedLine } : {}),
    }));
  };

  const selectConsignee = (item) => {
    setForm((prev) => ({
      ...prev,
      consigneeName: item.companyName || "",
      consigneeAddress: item.address || "",
      consigneeCity: item.city || "",
      consigneeState: item.state || "",
      consigneeZip: item.postalCode || "",
      consigneeCountry: item.country || "",
    }));
  };

  const selectExporter = (item) => {
    setForm((prev) => ({
      ...prev,
      exporterName: item.companyName || "",
      exporterAddress: item.address || "",
      exporterCity: item.city || "",
      exporterState: item.state || "",
      exporterZip: item.postalCode || "",
      exporterCountry: item.country || "UNITED STATES",
    }));
  };

  const selectPickup = (item) => {
    setForm((prev) => ({
      ...prev,
      pickupLocation: item.companyName || "",
      pickupName: item.companyName || "",
      pickupAddress: item.address || "",
      pickupCity: item.city || "",
      pickupState: item.state || "",
      pickupZip: item.postalCode || "",
    }));
  };

  // ── Nearest warehouse by pickup state ────────────────────────────────────
  const WH_LIST = [
    { name: "EZ CARGO",             address: "3220 Bordentown Avenue",   city: "Old Bridge",  state: "NJ", zip: "08857", lat: 40.45, lng: -74.32 },
    { name: "SAVANNAH AUTO EXPORT", address: "109A Barrow Dr",           city: "Pooler",      state: "GA", zip: "31322", lat: 32.08, lng: -81.10 },
    { name: "ISHIP",                address: "9324 Tavenor Ln",          city: "Houston",     state: "TX", zip: "77075", lat: 29.76, lng: -95.37 },
    { name: "CEDARS EXPRESS",       address: "19070 S Reyes Ave",        city: "Compton",     state: "CA", zip: "90221", lat: 33.90, lng: -118.22 },
  ];
  const WH_CENTROIDS = {
    AL:[32.80,-86.79],AZ:[34.05,-111.09],AR:[34.97,-92.37],CA:[36.78,-119.42],
    CO:[39.06,-105.31],CT:[41.60,-72.70],DE:[38.99,-75.51],FL:[27.99,-81.76],
    GA:[32.68,-83.44],ID:[44.07,-114.74],IL:[40.35,-88.99],IN:[39.85,-86.26],
    IA:[42.01,-93.21],KS:[38.53,-96.73],KY:[37.67,-84.87],LA:[31.17,-91.87],
    ME:[44.69,-69.38],MD:[39.07,-76.80],MA:[42.23,-71.53],MI:[44.32,-85.60],
    MN:[46.39,-94.64],MS:[32.74,-89.67],MO:[38.46,-92.29],MT:[46.88,-110.36],
    NE:[41.49,-99.90],NV:[38.31,-117.06],NH:[43.45,-71.56],NJ:[40.30,-74.52],
    NM:[34.84,-106.25],NY:[42.17,-74.95],NC:[35.63,-79.81],ND:[47.53,-99.78],
    OH:[40.19,-82.67],OK:[35.56,-96.93],OR:[44.57,-122.07],PA:[40.59,-77.21],
    RI:[41.68,-71.51],SC:[33.84,-80.94],SD:[44.37,-100.35],TN:[35.86,-86.35],
    TX:[31.17,-99.33],UT:[39.32,-111.09],VT:[44.05,-72.71],VA:[37.77,-78.17],
    WA:[47.40,-121.49],WV:[38.49,-80.95],WI:[44.27,-89.62],WY:[42.96,-107.55],
  };
  const nearestWarehouse = (stateCode) => {
    const coords = WH_CENTROIDS[(stateCode || "").toUpperCase().trim()];
    if (!coords) return null;
    const hav = (a,b,c,d) => { const R=3958.8,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
    let best = null, bestD = Infinity;
    for (const wh of WH_LIST) { const d = hav(coords[0],coords[1],wh.lat,wh.lng); if (d < bestD) { bestD = d; best = wh; } }
    return best ? { ...best, miles: Math.round(bestD) } : null;
  };

  const PORT_LIST = [
    { name: "BALTIMORE",    city: "Baltimore",   state: "MD", lat: 39.27, lng: -76.58 },
    { name: "JACKSONVILLE", city: "Jacksonville",state: "FL", lat: 30.33, lng: -81.65 },
    { name: "FREEPORT",     city: "Freeport",    state: "TX", lat: 28.95, lng: -95.36 },
    { name: "DAVISVILLE",   city: "Davisville",  state: "RI", lat: 41.67, lng: -71.42 },
    { name: "WILMINGTON",   city: "Wilmington",  state: "NC", lat: 34.23, lng: -77.95 },
    { name: "BRUNSWICK",    city: "Brunswick",   state: "GA", lat: 31.14, lng: -81.49 },
  ];
  const nearestPort = (stateCode) => {
    const coords = WH_CENTROIDS[(stateCode || "").toUpperCase().trim()];
    if (!coords) return null;
    const hav = (a,b,c,d) => { const R=3958.8,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
    let best = null, bestD = Infinity;
    for (const p of PORT_LIST) { const d = hav(coords[0],coords[1],p.lat,p.lng); if (d < bestD) { bestD = d; best = p; } }
    return best ? { ...best, miles: Math.round(bestD) } : null;
  };

  // Normalize city string for matching — strips punctuation + expands abbreviations
  // so "FT PIERCE" === "FORT PIERCE", "ST PETE" === "SAINT PETE", etc.
  const normCity = (s) => {
    if (!s) return "";
    let c = s.toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim().replace(/\s+/g, " ");
    c = c.replace(/\bFT\b/g, "FORT").replace(/\bST\b/g, "SAINT").replace(/\bMT\b/g, "MOUNT");
    return c;
  };

  // After RORO + pickup city is known, look up towing charges and suggest the port.
  // shippingLineHint is forwarded to handlePolChange so the right terminal is picked.
  // State → default POL when no city-level pricing entry matches
  const stateToPort = {
    TX: "FREEPORT", FL: "JACKSONVILLE", MD: "BALTIMORE", GA: "BRUNSWICK",
    NC: "WILMINGTON", VA: "BALTIMORE", SC: "BRUNSWICK", NJ: "NEWARK",
    NY: "NEWARK", PA: "BALTIMORE", DE: "BALTIMORE", RI: "PROVIDENCE",
    MA: "PROVIDENCE", CT: "PROVIDENCE",
  };

  // Shipping line by port — overrides POD-based hint when pickup region is known
  // For FREEPORT: ACL serves TEMA, SALLAUM serves LAGOS/COTONOU/LOME
  const getShippingLineForPort = (port, pod) => {
    const p = (port || "").toUpperCase();
    const d = (pod  || "").toUpperCase();
    if (p === "FREEPORT") return ["LAGOS","COTONOU","LOME","DAKAR"].includes(d) ? "SALLAUM" : "ACL";
    if (p === "PROVIDENCE")  return "SALLAUM";
    if (p === "JACKSONVILLE") return "SALLAUM";
    if (p === "NEWARK")      return "SALLAUM";
    if (p === "BRUNSWICK")   return "SALLAUM";
    if (p === "WILMINGTON")  return "SALLAUM";
    if (p === "BALTIMORE")   return ["LAGOS","COTONOU","LOME"].includes(d) ? "SALLAUM" : "ACL";
    return "";
  };

  const suggestDeliveryFromPickupCity = async (city, shippingLineHint, state, podOverride) => {
    if (!city && !state) return;
    try {
      const res = await fetch(`${API}/api/pricing?type=towing`);
      const rates = await res.json();
      const cityNorm = normCity(city || "");
      const match =
        rates.find((r) => normCity(r.city) === cityNorm && r.port) ||
        rates.find((r) => normCity(r.city) === cityNorm) ||
        rates.find((r) => r.port && r.name && cityNorm && normCity(r.name).includes(cityNorm));

      const port = match?.port || (state && stateToPort[state.toUpperCase()]);
      if (port) {
        const pod = podOverride || form.pod;
        const lineHint = shippingLineHint || getShippingLineForPort(port, pod);
        handlePolChange(port.toUpperCase(), lineHint);
      }
    } catch (err) {
      console.error("Towing city lookup failed", err);
    }
  };

  const derivePol = (name) => {
    const u = (name || "").toUpperCase();
    if (u.includes("PROVIDENCE") || u.includes("DAVISVILLE")) return "PROVIDENCE";
    if (u.includes("BALTIMORE") || u.includes("LOCUST") || u.includes("TRADEPOINT")) return "BALTIMORE";
    if (u.includes("JACKSONVILLE") || u.includes("JAX")) return "JACKSONVILLE";
    if (u.includes("FREEPORT")) return "FREEPORT";
    if (u.includes("WILMINGTON")) return "WILMINGTON";
    if (u.includes("BRUNSWICK")) return "BRUNSWICK";
    if (u.includes("NEWARK")) return "NEWARK";
    return "";
  };

  // When POL is picked from dropdown, look up matching port in address book and auto-fill delivery.
  // shippingLineHint lets callers pass the known shipping line so we search by line name first
  // (e.g. search "SALLAUM" → finds "SALLAUM – DAVISVILLE" regardless of port city in its name).
  // Only falls back to bare port-name search when no shipping line is known.
  const handlePolChange = async (polValue, shippingLineHint) => {
    update("pol", polValue);
    if (!polValue) return;
    try {
      let picked = null;
      const line = (shippingLineHint || form.shippingLine || "").trim();

      if (line) {
        // 1. Search by shipping line name only — finds "SALLAUM – DAVISVILLE", "ACL – PROVIDENCE", etc.
        const r1 = await fetch(
          `${API}/api/address-book?search=${encodeURIComponent(line)}&type=port`
        ).then(r => r.json());
        if (Array.isArray(r1) && r1.length) {
          // If multiple results for this line, prefer one whose name/city mentions the port
          const portMatch = r1.find(e =>
            (e.companyName || "").toUpperCase().includes(polValue.toUpperCase()) ||
            (e.city        || "").toUpperCase().includes(polValue.toUpperCase())
          );
          picked = portMatch || r1[0];
        }
      }

      // 2. Fallback: port-name search — only used when shipping line is unknown
      if (!picked) {
        const r2 = await fetch(
          `${API}/api/address-book?search=${encodeURIComponent(polValue)}&type=port`
        ).then(r => r.json());
        if (Array.isArray(r2) && r2.length) {
          // If we know the shipping line, exclude terminals belonging to the other line
          const OPPOSITE = line.toUpperCase() === "SALLAUM" ? "ACL" : line.toUpperCase() === "ACL" ? "SALLAUM" : null;
          const filtered = OPPOSITE
            ? r2.filter(e => !(e.companyName || "").toUpperCase().includes(OPPOSITE))
            : r2;
          picked = filtered[0] || r2[0];
        }
      }

      if (picked) {
        setForm((prev) => ({
          ...prev,
          deliveryLocation: picked.companyName || prev.deliveryLocation,
          deliveryName:     picked.companyName || prev.deliveryName,
          deliveryAddress:  picked.address     || prev.deliveryAddress,
          deliveryCity:     picked.city        || prev.deliveryCity,
          deliveryState:    picked.state       || prev.deliveryState,
          deliveryZip:      picked.postalCode  || prev.deliveryZip,
        }));
      }
    } catch (err) {
      console.error("POL address lookup failed", err);
    }
  };

  const selectDelivery = (item) => {
    const pol = derivePol(item.companyName);
    setForm((prev) => ({
      ...prev,
      deliveryLocation: item.companyName || "",
      deliveryName: item.companyName || "",
      deliveryAddress: item.address || "",
      deliveryCity: item.city || "",
      deliveryState: item.state || "",
      deliveryZip: item.postalCode || "",
      ...(pol ? { pol } : {}),
    }));
  };


  // ── Shared: open confirmation popup after parse ────────────────────────
  const openParsePopup = (data, file, label) => {
    const detectedType = data.requestType === "Container" ? "Container" : "RORO";
    setPopupType(detectedType);
    setPopupContainerSize(data.containerSize || "");
    setPopupWarehouse(null);
    setPopupCustomerName(data.customerName || "");
    setPopupCustSuggestions([]);
    setPopupCustRecord(null);
    setParsePopup({ data, file, label });
  };

  // ── Shared: apply parsed data to form (called on popup confirm) ────────
  const applyParsedData = (data, type, containerSize, warehouse) => {
    const rec = data.customerRecord;
    const podFromCustomer = rec?.defaultPod || countryToPod(rec?.country);
    const effectivePod  = data.pod || podFromCustomer || "";
    const effectiveLine = type === "Container" && data.shippingLine
      ? data.shippingLine
      : podToShippingLine(podFromCustomer) || data.shippingLine || "";

    setForm(prev => ({
      ...prev,
      requestType:      type,
      customerName:     rec?.companyName  || data.customerName  || prev.customerName,
      customerPhone:    rec?.phone        || data.customerPhone || prev.customerPhone,
      customerEmail:    rec?.email        || data.customerEmail || prev.customerEmail,
      source:           rec?.defaultOffice || "USA OFFICE",
      buyerName:        data.buyerName    || prev.buyerName,
      consigneeName:    data.consigneeName    || data.buyerName || data.customerName || prev.consigneeName,
      consigneeAddress: data.consigneeAddress || prev.consigneeAddress,
      consigneeCity:    data.consigneeCity    || prev.consigneeCity,
      consigneeCountry: data.consigneeCountry || prev.consigneeCountry,
      vin:       data.vin       || prev.vin,
      year:      data.year      || prev.year,
      make:      data.make      || prev.make,
      model:     data.model     || prev.model,
      lotNumber: data.lotNumber || prev.lotNumber,
      pickupLocation: data.pickupLocation || data.pickupName || prev.pickupLocation,
      pickupName:     data.pickupName    || prev.pickupName,
      pickupAddress:  data.pickupAddress || prev.pickupAddress,
      pickupCity:     data.pickupCity    || prev.pickupCity,
      pickupState:    data.pickupState   || prev.pickupState,
      pickupZip:      data.pickupZip     || prev.pickupZip,
      pod:            effectivePod       || prev.pod,
      shippingLine:   effectiveLine      || prev.shippingLine,
      ...(data.towingQuote ? { towingCharge: data.towingQuote } : {}),
      // Container-specific
      containerSize: containerSize || prev.containerSize || "",
      ...(warehouse ? {
        deliveryLocation: warehouse.name,
        deliveryName:     warehouse.name,
        deliveryAddress:  warehouse.address,
        deliveryCity:     warehouse.city,
        deliveryState:    warehouse.state,
        deliveryZip:      warehouse.zip,
        pol:              warehouse.pol,
      } : {}),
    }));

    if (data.vin && data.vin.length === 17) decodeVin(data.vin);
    if (type !== "Container" && (data.pickupCity || data.pickupState)) {
      suggestDeliveryFromPickupCity(data.pickupCity, effectiveLine, data.pickupState, effectivePod);
    }
  };

  // ── Buyer Receipt handler ──────────────────────────────────────────────
  const handleBuyerReceiptFile = async (file) => {
    if (!file) return;
    setBrFile(file);
    setBrParsing(true);
    setBrResult(null);
    setBrCustomerFound(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/api/orders/parse-buyer-receipt`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");

      // ── Buyer account → customer lookup ──────────────────────────
      if (data.customerName) {
        try {
          const buyerLookup = await fetch(`${API}/api/address-book/lookup-buyer?name=${encodeURIComponent(data.customerName)}`);
          const buyerData = await buyerLookup.json();
          if (buyerData.customer) {
            // Found a real customer for this buyer account
            data.buyerName      = data.customerName; // keep receipt name as buyerName
            data.customerName   = buyerData.customer.companyName;
            data.customerPhone  = data.customerPhone || buyerData.customer.phone || "";
            data.customerEmail  = data.customerEmail || buyerData.customer.email || "";
            data.customerRecord = buyerData.customer;
            data.customerFound  = true;
          }
        } catch {}
      }

      setBrResult(data);
      setBrCustomerFound(data.customerFound);
      openParsePopup(data, file, "Buyer Receipt");
    } catch (err) {
      console.error("Buyer receipt parse error:", err);
      setBrResult({ error: err.message });
    } finally {
      setBrParsing(false);
    }
  };

  // ── Order Request Form handler — same parse endpoint, takes priority if both uploaded ──
  const handleOrderRequestFile = async (file) => {
    if (!file) return;
    setOrfFile(file);
    setOrfParsing(true);
    setOrfResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/api/orders/parse-buyer-receipt`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");

      // Same customer lookup as buyer receipt
      if (data.customerName) {
        try {
          const buyerLookup = await fetch(`${API}/api/address-book/lookup-buyer?name=${encodeURIComponent(data.customerName)}`);
          const buyerData = await buyerLookup.json();
          if (buyerData.customer) {
            data.buyerName     = data.customerName;
            data.customerName  = buyerData.customer.companyName;
            data.customerPhone = data.customerPhone || buyerData.customer.phone || "";
            data.customerEmail = data.customerEmail || buyerData.customer.email || "";
            data.customerRecord = buyerData.customer;
            data.customerFound  = true;
          }
        } catch {}
      }

      setOrfResult(data);
      openParsePopup(data, file, "Order Request Form");
    } catch (err) {
      setOrfResult({ error: err.message });
    } finally {
      setOrfParsing(false);
    }
  };


  const submitOrder = async (e) => {
    e.preventDefault();

    setMessage("Saving order...");
    setDupOrderId(null);

    const res = await fetch(`${API}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, refNumber: manualRef || undefined }),
    });

    const data = await res.json();

    if (res.status === 409) {
      setMessage(data.error || "Duplicate VIN");
      setDupOrderId(data.existingId || null);
      return;
    }

    if (!res.ok) {
      setMessage(data.error || "Failed to create order");
      return;
    }

    // Upload buyer receipt and/or order request form
    const filesToUpload = [
      ...(brFile  ? [{ file: brFile,  label: "Buyer Receipt"       }] : []),
      ...(orfFile ? [{ file: orfFile, label: "Order Request Form"  }] : []),
    ];
    if (filesToUpload.length && data._id) {
      setMessage(`✅ Order ${data.refNumber} created — uploading documents…`);
      for (const { file, label } of filesToUpload) {
        try {
          const fd = new FormData();
          fd.append("file",  file);
          fd.append("label", label);
          await fetch(`${API}/api/orders/${data._id}/upload-drive`, { method: "POST", body: fd });
        } catch (upErr) {
          console.error(`${label} upload failed:`, upErr);
        }
      }
      setMessage(`✅ Order ${data.refNumber} created — documents saved.`);
      setBrFile(null);
      setOrfFile(null);
    } else {
      setMessage(`✅ Order created. Ref #${data.refNumber}`);
    }
    navigate(`/orders/${data._id}`);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Create New Order</h1>
          <p>Create and manage a DDG shipment request.</p>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card" style={{ cursor:"default" }}>
          <span style={{ marginBottom:8, display:"block" }}>Order Type</span>
          <div style={{ display:"flex", gap:8 }}>
            {["RORO","Container"].map(t => (
              <button key={t} type="button"
                onClick={() => {
                  update("requestType", t);
                  if (t === "Container" && form.pickupState) {
                    // Switch delivery to nearest container warehouse
                    const wh = nearestWarehouse(form.pickupState);
                    if (wh) {
                      setForm(prev => ({
                        ...prev,
                        requestType:     t,
                        deliveryLocation: wh.name,
                        deliveryName:     wh.name,
                        deliveryAddress:  wh.address,
                        deliveryCity:     wh.city,
                        deliveryState:    wh.state,
                        deliveryZip:      wh.zip,
                        pol:              wh.pol || prev.pol,
                        // clear RORO vessel fields
                        vessel: "", voyage: "", sailDate: "", cutoffDate: "", arrivalDate: "",
                      }));
                    }
                  } else if (t === "RORO" && (form.pickupCity || form.pickupState)) {
                    // Switch delivery back to nearest RORO port
                    suggestDeliveryFromPickupCity(form.pickupCity, "", form.pickupState);
                  }
                }}
                style={{
                  flex:1, padding:"7px 0", borderRadius:8, cursor:"pointer",
                  fontWeight:700, fontSize:13, border:"none",
                  background: form.requestType === t
                    ? (t === "Container" ? "#2563eb" : "#059669")
                    : "var(--bg-panel)",
                  color: form.requestType === t ? "#fff" : "var(--text-muted)",
                  outline: form.requestType === t ? "none" : "1px solid var(--border)",
                }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-card">
          <span>Request Date</span>
          <strong className="small">{form.requestDate}</strong>
        </div>

        <div className="dashboard-card">
          <span>VIN / Chassis</span>
          <strong className="small" style={{ fontFamily: "monospace", letterSpacing: "0.04em" }}>
            {form.vin || "—"}
          </strong>
        </div>

        <div className="dashboard-card">
          <span>Processed By</span>
          <strong className="small">{form.processedBy || "—"}</strong>
        </div>
      </div>

      <form onSubmit={submitOrder} className="order-form-pro">

        {/* ── Order Number ─────────────────────────────────────────────── */}
        <section className="form-section" style={{ paddingBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Order Number
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="text"
                  value={manualRef}
                  readOnly={refLocked}
                  onChange={e => !refLocked && setManualRef(e.target.value)}
                  style={{
                    width: 130, padding: "8px 12px", borderRadius: 8, fontSize: 20, fontWeight: 700,
                    background: refLocked ? "var(--bg-panel)" : "var(--bg-input)",
                    border: `2px solid ${refLocked ? "var(--border)" : "#1a6ef7"}`,
                    color: refLocked ? "var(--text-muted)" : "#60a5fa",
                    outline: "none", textAlign: "center",
                    cursor: refLocked ? "default" : "text",
                  }}
                />
                {!refLocked && manualRef !== nextRef && (
                  <button type="button" onClick={() => setManualRef(nextRef)}
                    style={{ fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                    Reset to {nextRef}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                {refLocked ? "🔒 Auto-generated" : "✏️ Custom — type your old order number"}
              </div>
            </div>
            {/* Add Old Order button */}
            {refLocked ? (
              <button type="button"
                onClick={() => { setRefLocked(false); setManualRef(""); }}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.4)",
                  background: "rgba(251,191,36,0.08)", color: "#fbbf24",
                  cursor: "pointer", fontSize: 12, fontWeight: 600, marginTop: 4,
                }}>
                📦 Add Old Order
              </button>
            ) : (
              <button type="button"
                onClick={() => { setRefLocked(true); setManualRef(nextRef); }}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--bg-panel)", color: "var(--text-muted)",
                  cursor: "pointer", fontSize: 12, marginTop: 4,
                }}>
                ← Use Auto Number
              </button>
            )}
          </div>
        </section>

        {/* ── Upload Zones: Buyer Receipt + Order Request Form ─────────── */}
        <section className="form-section" style={{ paddingBottom: 0 }}>
          <h2 style={{ marginBottom: 10 }}>Auto-Fill Documents</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -6, marginBottom: 12 }}>
            Upload one or both. If both uploaded, <strong>Order Request Form takes priority</strong> for parsing.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>

            {/* Buyer Receipt — LEFT */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>🧾 Buyer Receipt</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setBrDragging(true); }}
            onDragLeave={() => setBrDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setBrDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleBuyerReceiptFile(file);
            }}
            onClick={() => brInputRef.current?.click()}
            style={{
              border: `2px dashed ${brDragging ? "var(--accent)" : brFile ? "#34d399" : "var(--border)"}`,
              borderRadius: 10,
              padding: "16px 12px",
              textAlign: "center",
              cursor: "pointer",
              background: brDragging ? "rgba(99,102,241,0.07)" : brFile ? "rgba(52,211,153,0.05)" : "var(--bg-panel)",
              color: "var(--text-secondary)",
              fontSize: 12,
              transition: "all 0.15s",
            }}
          >
            {brParsing
              ? "⏳ Parsing buyer receipt…"
              : brFile ? `✅ ${brFile.name}` : "Drop Buyer Receipt PDF here"}
            <input
              ref={brInputRef}
              type="file"
              accept=".pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleBuyerReceiptFile(file);
                e.target.value = "";
              }}
            />
          </div>
          {brResult && !brResult.error && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#34d399" }}>
              ✅ Parsed · {brResult.customerName || ""} {brResult.vin ? `· VIN: ${brResult.vin}` : ""}
            </div>
          )}
          {brResult?.error && <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>❌ {brResult.error}</div>}
          {brCustomerFound === false && brResult?.customerName && !newCustPopup && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#fcd34d" }}>⚠️ New customer detected</div>
          )}
            </div>

            {/* Order Request Form — RIGHT */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>📋 Order Request Form</div>
              <div
                onDragOver={(e) => { e.preventDefault(); setOrfDragging(true); }}
                onDragLeave={() => setOrfDragging(false)}
                onDrop={(e) => { e.preventDefault(); setOrfDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleOrderRequestFile(f); }}
                onClick={() => orfInputRef.current?.click()}
                style={{
                  border: `2px dashed ${orfDragging ? "var(--accent)" : orfFile ? "#34d399" : "var(--border)"}`,
                  borderRadius: 10, padding: "16px 12px", textAlign: "center", cursor: "pointer",
                  background: orfDragging ? "rgba(99,102,241,0.07)" : orfFile ? "rgba(52,211,153,0.05)" : "var(--bg-panel)",
                  color: "var(--text-secondary)", fontSize: 12, transition: "all 0.15s",
                }}>
                {orfParsing ? "⏳ Parsing…" : orfFile ? `✅ ${orfFile.name}` : "Drop Order Request Form PDF here"}
                <input ref={orfInputRef} type="file" accept=".pdf" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOrderRequestFile(f); e.target.value = ""; }} />
              </div>
              {orfResult && !orfResult.error && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#34d399" }}>
                  ✅ Parsed · {orfResult.customerName || ""} {orfResult.vin ? `· VIN: ${orfResult.vin}` : ""}
                </div>
              )}
              {orfResult?.error && <div style={{ marginTop: 6, fontSize: 11, color: "#f87171" }}>❌ {orfResult.error}</div>}
            </div>

          </div>{/* end grid */}
        </section>

        <section className="form-section">
          <h2>Parties</h2>

          <AddressSearch
            label="Customer"
            type="customer"
            value={form.customerName}
            onSelect={(item) => { selectCustomer(item); setCustSuggestion(null); }}
          />

          {/* ── Close match warning ──────────────────────────────────── */}
          {custSuggestion && (
            <div style={{
              background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)",
              borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#fbbf24",
              marginTop: -10, marginBottom: 12, display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 12,
            }}>
              <span>⚠️ Close match found: <strong>{custSuggestion.companyName}</strong> — use existing instead of creating a duplicate?</span>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button type="button"
                  onClick={() => { selectCustomer(custSuggestion); setCustSuggestion(null); }}
                  style={{ background: "#fbbf24", border: "none", borderRadius: 6, color: "#000",
                    padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  Use Existing
                </button>
                <button type="button" onClick={() => setCustSuggestion(null)}
                  style={{ background: "none", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 6,
                    color: "#fbbf24", padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                  Ignore
                </button>
              </div>
            </div>
          )}

          <AddressSearch
            label="Buyer / Consignee"
            type="customer"
            value={form.consigneeName}
            onSelect={selectConsignee}
          />

          <AddressSearch
            label="Exporter / USPPI"
            type="USPPI"
            value={form.exporterName}
            onSelect={selectExporter}
          />

          {/* Buyer account match banner */}
          {form.buyerName && form.buyerName !== form.customerName && (
            <div style={{ background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.3)",
              borderRadius:8, padding:"8px 14px", fontSize:12, color:"#fbbf24", marginBottom:10 }}>
              📋 Buyer account on receipt: <strong>{form.buyerName}</strong> → Customer auto-set to <strong>{form.customerName}</strong>
            </div>
          )}

          <div className="form-grid">
            <label>
              Business Name
              <input
                value={form.customerName}
                onChange={(e) => update("customerName", e.target.value)}
                placeholder="e.g. AHAB GENERAL ENTERPRISES"
              />
            </label>

            <label>
              Buyer Account (on receipt)
              <input
                value={form.buyerName}
                onChange={(e) => update("buyerName", e.target.value)}
                placeholder="e.g. GOLDEN NOOR INTERNATIONAL"
                style={{ color: "var(--text-secondary)" }}
              />
            </label>

            <label>
              Contact Name
              <input
                value={form.contactName}
                onChange={(e) => update("contactName", e.target.value)}
                placeholder="e.g. John Doe"
              />
            </label>

            <label>
              Phone / WhatsApp
              <input
                value={form.customerPhone}
                onChange={(e) => update("customerPhone", e.target.value)}
              />
            </label>

            <label>
              Email
              <input
                value={form.customerEmail}
                onChange={(e) =>
                  update("customerEmail", e.target.value)
                }
              />
            </label>

            <label>
              Processed By
              <input
                value={form.processedBy}
                onChange={(e) =>
                  update("processedBy", e.target.value)
                }
              />
            </label>

            <label>
              Source / Office
              <select
                value={form.source}
                onChange={(e) => update("source", e.target.value)}
              >
                <option value="USA OFFICE">🇺🇸 USA Office</option>
                <option value="GHANA OFFICE">🇬🇭 Ghana Office</option>
              </select>
            </label>

            <label>
              Request Type
              <select
                value={form.requestType}
                onChange={(e) => {
                  const newType = e.target.value;
                  if (newType === "Container" && form.pickupState) {
                    const wh = nearestWarehouse(form.pickupState);
                    if (wh) {
                      setForm(prev => ({
                        ...prev,
                        requestType:      newType,
                        deliveryLocation: wh.name,
                        deliveryName:     wh.name,
                        deliveryAddress:  wh.address,
                        deliveryCity:     wh.city,
                        deliveryState:    wh.state,
                        deliveryZip:      wh.zip,
                        pol:              wh.pol || prev.pol,
                        vessel: "", voyage: "", sailDate: "", cutoffDate: "", arrivalDate: "",
                      }));
                      return;
                    }
                  }
                  update("requestType", newType);
                  if (newType === "RORO" && (form.pickupCity || form.pickupState)) {
                    suggestDeliveryFromPickupCity(form.pickupCity, "", form.pickupState);
                  }
                }}
              >
                <option>RORO</option>
                <option>Container</option>
              </select>
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>Vehicle</h2>

          <div className="form-grid">
            <label>
              VIN
              <input
                value={form.vin}
                onChange={(e) => {
                  const vin = e.target.value.toUpperCase();

                  update("vin", vin);

                  decodeVin(vin);
                }}
              />
            </label>

            <label>
              Year
              <input
                value={form.year}
                onChange={(e) =>
                  update("year", e.target.value)
                }
              />
            </label>

            <label>
              Make
              <input
                value={form.make}
                onChange={(e) =>
                  update("make", e.target.value)
                }
              />
            </label>

            <label>
              Model
              <input
                value={form.model}
                onChange={(e) =>
                  update("model", e.target.value)
                }
              />
            </label>

            <label>
              Color
              <input
                value={form.color}
                onChange={(e) =>
                  update("color", e.target.value)
                }
              />
            </label>

          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <label>
              Lot#
              <input
                value={form.lotNumber}
                onChange={(e) => update("lotNumber", e.target.value)}
                placeholder="e.g. 12345678"
              />
            </label>

            <label>
              PIN
              <input
                value={form.pin}
                onChange={(e) => update("pin", e.target.value)}
                placeholder="Gate release PIN"
              />
            </label>

            <label>
              Condition
              <select
                value={form.condition}
                onChange={(e) =>
                  update("condition", e.target.value)
                }
              >
                <option>Runner</option>
                <option>Nonrunner</option>
                <option>Forklift</option>
              </select>
            </label>

            <label>
              Title Status
              <select
                value={form.titleStatus}
                onChange={(e) =>
                  update("titleStatus", e.target.value)
                }
              >
                <option>Pending</option>
                <option>Title</option>
                <option>No Title</option>
              </select>
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>Locations & Shipping</h2>

          <AddressSearch
            label="Pickup Location"
            value={form.pickupLocation}
            onSelect={selectPickup}
          />

          <AddressSearch
            label="Delivery / Port Location"
            value={form.deliveryLocation}
            onSelect={selectDelivery}
          />

          {/* ── Warehouse Picker (Container orders only) ──────────────── */}
          {form.requestType === "Container" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                🏭 Select Warehouse (Delivery Location)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {WH_LIST.map(wh => {
                  const isSelected = form.deliveryName === wh.name;
                  return (
                    <div
                      key={wh.name}
                      onClick={() => setForm(prev => ({
                        ...prev,
                        deliveryLocation: wh.name,
                        deliveryName:     wh.name,
                        deliveryAddress:  wh.address,
                        deliveryCity:     wh.city,
                        deliveryState:    wh.state,
                        deliveryZip:      wh.zip,
                      }))}
                      style={{
                        background: isSelected ? "rgba(16,185,129,0.15)" : "var(--bg-panel)",
                        border: `1.5px solid ${isSelected ? "rgba(16,185,129,0.6)" : "var(--border)"}`,
                        borderRadius: 8, padding: "10px 14px", cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, color: isSelected ? "#34d399" : "var(--text-primary)", marginBottom: 3 }}>
                        {wh.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                        {wh.address}<br />{wh.city}, {wh.state} {wh.zip}
                      </div>
                      {isSelected && (
                        <div style={{ marginTop: 6, fontSize: 11, color: "#34d399", fontWeight: 600 }}>✓ Selected</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {form.deliveryName && WH_LIST.some(w => w.name === form.deliveryName) && (
                <button type="button" onClick={() => setForm(prev => ({
                  ...prev, deliveryLocation: "", deliveryName: "", deliveryAddress: "", deliveryCity: "", deliveryState: "", deliveryZip: "",
                }))}
                  style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Clear selection
                </button>
              )}
            </div>
          )}

          <div className="form-grid">
            <label>
              Pickup
              <input
                value={form.pickupLocation}
                onChange={(e) =>
                  update("pickupLocation", e.target.value)
                }
              />
            </label>

            <label>
              Delivery
              <input
                value={form.deliveryLocation}
                onChange={(e) =>
                  update("deliveryLocation", e.target.value)
                }
              />
            </label>

            {form.requestType === "Container" && (
            <label>
              Shipping Line
              <select
                value={form.shippingLine}
                onChange={(e) =>
                  update("shippingLine", e.target.value)
                }
              >
                <option value="">Choose...</option>
                <option>OOCL</option>
                <option>MAERSK</option>
                <option>HAPAG LLOYD</option>
                <option>ARKAS</option>
                <option>MSC</option>
                <option>CMA CGM</option>
              </select>
            </label>
            )}

            <label style={{ gridColumn: "1 / -1" }}>
              Port of Loading
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {(form.requestType === "Container"
                  ? ["NEW YORK","SAVANNAH","LONG BEACH","HOUSTON"]
                  : ["BALTIMORE","JACKSONVILLE","PROVIDENCE","FREEPORT","WILMINGTON","BRUNSWICK","NEWARK"]
                ).map(p => (
                  <button key={p} type="button" onClick={() => handlePolChange(p)}
                    style={{
                      padding: "5px 13px", borderRadius: 20, cursor: "pointer", fontSize: 12,
                      border: "1px solid var(--border)",
                      background: form.pol === p ? "var(--accent)" : "var(--bg-panel)",
                      color: form.pol === p ? "#fff" : "var(--text-secondary)",
                      fontWeight: form.pol === p ? 600 : 400,
                      transition: "all 0.1s",
                    }}
                  >{p}</button>
                ))}
                {form.pol && (
                  <button type="button" onClick={() => handlePolChange("")}
                    style={{ padding: "5px 10px", borderRadius: 20, cursor: "pointer", fontSize: 11,
                      border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}>
                    ✕ Clear
                  </button>
                )}
              </div>
            </label>

            <label style={{ gridColumn: "1 / -1" }}>
              Port of Discharge
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {["LAGOS","TEMA","COTONOU","LOME","DAKAR","DURBAN","ABIDJAN"].map(p => (
                  <button key={p} type="button" onClick={() => {
                    const line = podToShippingLine(p);
                    setForm(prev => ({ ...prev, pod: p, ...(line ? { shippingLine: line } : {}) }));
                    lookupSchedule(form.vessel, form.pol, p);
                  }}
                    style={{
                      padding: "5px 13px", borderRadius: 20, cursor: "pointer", fontSize: 12,
                      border: "1px solid var(--border)",
                      background: form.pod === p ? "var(--accent)" : "var(--bg-panel)",
                      color: form.pod === p ? "#fff" : "var(--text-secondary)",
                      fontWeight: form.pod === p ? 600 : 400,
                      transition: "all 0.1s",
                    }}
                  >{p}</button>
                ))}
                {form.pod && (
                  <button type="button" onClick={() => update("pod", "")}
                    style={{ padding: "5px 10px", borderRadius: 20, cursor: "pointer", fontSize: 11,
                      border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)" }}>
                    ✕ Clear
                  </button>
                )}
              </div>
            </label>

            <label>
              Booking Number
              <input
                value={form.bookingNumber}
                onChange={(e) => update("bookingNumber", e.target.value)}
              />
            </label>

            {form.requestType === "Container" && (
              <>
                <label>
                  Container #
                  <input
                    value={form.containerNumber}
                    onChange={(e) => update("containerNumber", e.target.value.toUpperCase())}
                    placeholder="e.g. MSCU1234567"
                  />
                </label>
                <label>
                  Seal #
                  <input
                    value={form.sealNumber}
                    onChange={(e) => update("sealNumber", e.target.value.toUpperCase())}
                    placeholder="e.g. SL123456"
                  />
                </label>
              </>
            )}

            {/* ── Vessel / Schedule ── */}
            <label style={{ gridColumn: "1 / -1" }}>
              Vessel
              <div style={{ display:"flex", gap:8, marginTop:6 }}>
                <select
                  value={form.vessel}
                  onChange={e => {
                    update("vessel", e.target.value);
                    lookupSchedule(e.target.value, form.pol, form.pod);
                  }}
                  style={{ flex:1 }}
                >
                  <option value="">Select vessel…</option>
                  {scheduleVessels.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                {scheduleLooking && <span style={{ alignSelf:"center", fontSize:12, color:"var(--text-muted)" }}>Looking up…</span>}
              </div>
            </label>

            {form.vessel && (
              <div style={{ gridColumn:"1 / -1", display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10 }}>
                <label>Voyage
                  <input value={form.voyage} onChange={e => update("voyage", e.target.value)} placeholder="e.g. 26OE05" />
                </label>
                <label>Cutoff Date
                  <input type="date" value={form.cutoffDate ? form.cutoffDate.split("/").reverse().join("-").replace(/(\d{4})-(\d{2})-(\d{2})/, "$1-$2-$3") : ""}
                    onChange={e => update("cutoffDate", e.target.value)} />
                </label>
                <label>Sail Date
                  <input type="date" value={form.sailDate ? form.sailDate.split("/").reverse().join("-").replace(/(\d{4})-(\d{2})-(\d{2})/, "$1-$2-$3") : ""}
                    onChange={e => update("sailDate", e.target.value)} />
                </label>
                <label>Est. Arrival
                  <input type="date" value={form.arrivalDate ? form.arrivalDate.split("/").reverse().join("-").replace(/(\d{4})-(\d{2})-(\d{2})/, "$1-$2-$3") : ""}
                    onChange={e => update("arrivalDate", e.target.value)} />
                </label>
              </div>
            )}
            {form.vessel && form.pol && form.pod && !scheduleLooking && !form.sailDate && (
              <div style={{ gridColumn:"1 / -1", fontSize:12, color:"#f59e0b" }}>
                ⚠️ No schedule match found for this vessel + POL + POD combination.
              </div>
            )}
          </div>
        </section>

        {/* ── Suggested Port & Warehouse ───────────────────────────── */}
        {form.pickupState && (() => {
          const port = nearestPort(form.pickupState);
          const wh   = nearestWarehouse(form.pickupState);
          if (!port && !wh) return null;
          return (
            <section className="form-section" style={{ padding: "14px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
                ✦ Suggested for {form.pickupCity || form.pickupState}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {port && (
                  <div style={{
                    flex: 1, minWidth: 200,
                    background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.25)",
                    borderRadius: 8, padding: "10px 14px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>🚢</span>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>NEAREST PORT</div>
                      <strong style={{ fontSize: 14, color: "#60a5fa" }}>{port.name}</strong>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                        {port.city}, {port.state} — {port.miles} mi
                      </span>
                    </div>
                  </div>
                )}
                {wh && (
                  <div style={{
                    flex: 1, minWidth: 200,
                    background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)",
                    borderRadius: 8, padding: "10px 14px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontSize: 18 }}>🏭</span>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>NEAREST WAREHOUSE</div>
                      <strong style={{ fontSize: 14, color: "#34d399" }}>{wh.name}</strong>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                        {wh.address}, {wh.city}, {wh.state} {wh.zip} — {wh.miles} mi
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          );
        })()}

        <section className="form-section">
          <h2>Notes</h2>

          <textarea
            value={form.notes}
            onChange={(e) =>
              update("notes", e.target.value)
            }
            placeholder="Internal notes, pickup instructions, customer requests..."
          />
        </section>

        <div className="form-actions">
          <button type="submit">Save Order</button>

          {message && (
            <span style={{
              color: message.startsWith("✅") ? "#6ee7b7"
                   : dupOrderId             ? "#fca5a5"
                   : "var(--text-secondary)",
            }}>
              {message}
              {dupOrderId && (
                <button
                  type="button"
                  onClick={() => navigate(`/orders/${dupOrderId}`)}
                  style={{
                    marginLeft: 10,
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(239,68,68,0.4)",
                    background: "rgba(239,68,68,0.12)",
                    color: "#fca5a5",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  View Existing Order →
                </button>
              )}
            </span>
          )}
        </div>
      </form>

      {/* ── New Customer Contact Popup ─────────────────────────────────── */}
      {/* ── Parse Confirmation Popup ──────────────────────── */}
      {parsePopup && (
        <div className="modal-backdrop" onClick={() => setParsePopup(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 500 }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"var(--accent)", marginBottom:4 }}>
              Parsed from {parsePopup.label}
            </div>
            <h2 style={{ margin:"0 0 16px" }}>Confirm &amp; Apply</h2>

            {/* RORO / Container toggle */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:6 }}>Shipping Mode</div>
              <div style={{ display:"flex", gap:8 }}>
                {["RORO","Container"].map(t => (
                  <button key={t} type="button" onClick={() => { setPopupType(t); setPopupContainerSize(""); setPopupWarehouse(null); }}
                    style={{
                      flex:1, padding:"9px 0", borderRadius:8, cursor:"pointer", fontWeight:700, fontSize:14, border:"none",
                      background: popupType === t ? (t==="Container" ? "#2563eb" : "#059669") : "var(--bg-panel)",
                      color: popupType === t ? "#fff" : "var(--text-muted)",
                      outline: popupType === t ? "none" : "1px solid var(--border)",
                    }}>{t}</button>
                ))}
              </div>
            </div>

            {/* Container extras */}
            {popupType === "Container" && (
              <>
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:6 }}>Container Size</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {["FULL 40' HC","CONSOLIDATED SPOT","20'"].map(sz => (
                      <button key={sz} type="button" onClick={() => setPopupContainerSize(sz)}
                        style={{
                          padding:"6px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, border:"none",
                          background: popupContainerSize===sz ? "rgba(5,150,105,0.2)" : "var(--bg-panel)",
                          color: popupContainerSize===sz ? "#34d399" : "var(--text-muted)",
                          outline: popupContainerSize===sz ? "1px solid #34d399" : "1px solid var(--border)",
                        }}>{sz}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:6 }}>Warehouse / Delivery</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {[
                      { name:"EZ CARGO",            pol:"NEW YORK",   address:"3220 Bordentown Avenue", city:"Old Bridge",  state:"NJ", zip:"08857" },
                      { name:"SAVANNAH AUTO EXPORT", pol:"SAVANNAH",   address:"109A Barrow Dr",         city:"Pooler",      state:"GA", zip:"31322" },
                      { name:"ISHIP",               pol:"HOUSTON",    address:"9324 Tavenor Ln",        city:"Houston",     state:"TX", zip:"77075" },
                      { name:"CEDARS EXPRESS",       pol:"LONG BEACH", address:"19070 S Reyes Ave",      city:"Compton",     state:"CA", zip:"90221" },
                    ].map(wh => {
                      const sel = popupWarehouse?.name === wh.name;
                      return (
                        <button key={wh.name} type="button" onClick={() => setPopupWarehouse(sel ? null : wh)}
                          style={{
                            padding:"6px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, border:"none",
                            background: sel ? "rgba(37,99,235,0.2)" : "var(--bg-panel)",
                            color: sel ? "#60a5fa" : "var(--text-muted)",
                            outline: sel ? "1px solid #60a5fa" : "1px solid var(--border)",
                          }}>
                          {wh.name}
                          <span style={{ fontSize:10, opacity:0.7, marginLeft:4 }}>({wh.pol})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Parsed data summary */}
            <div style={{ background:"var(--bg-panel)", borderRadius:8, padding:"12px 14px", fontSize:12,
              border:"1px solid var(--border)", marginBottom:18, display:"flex", flexDirection:"column", gap:4 }}>
              {parsePopup.data.customerName && (
                <div style={{ display:"flex", alignItems:"center", gap:6, position:"relative" }}>
                  <span style={{ color:"var(--text-muted)", whiteSpace:"nowrap" }}>Customer: </span>
                  <div style={{ flex:1, position:"relative" }}>
                    <input
                      value={popupCustomerName}
                      onChange={e => {
                        const val = e.target.value;
                        setPopupCustomerName(val);
                        setPopupCustRecord(null);
                        if (val.length >= 2) {
                          clearTimeout(window._popupCustTimer);
                          window._popupCustTimer = setTimeout(async () => {
                            try {
                              const r = await fetch(`${API}/api/address-book?search=${encodeURIComponent(val)}&type=customer`);
                              const d = await r.json();
                              setPopupCustSuggestions(Array.isArray(d) ? d.slice(0, 6) : []);
                            } catch {}
                          }, 250);
                        } else {
                          setPopupCustSuggestions([]);
                        }
                      }}
                      style={{ width:"100%", background:"transparent", border:"none", borderBottom:"1px solid #374151",
                        color:"#f1f5f9", fontWeight:700, fontSize:12, padding:"1px 4px", outline:"none", cursor:"text", boxSizing:"border-box" }}
                      title="Click to edit customer name"
                    />
                    {popupCustSuggestions.length > 0 && (
                      <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:200,
                        background:"#1e2433", border:"1px solid #374151", borderRadius:6,
                        boxShadow:"0 8px 24px rgba(0,0,0,0.4)", maxHeight:180, overflowY:"auto" }}>
                        {popupCustSuggestions.map(c => (
                          <div key={c._id}
                            onMouseDown={e => {
                              e.preventDefault();
                              setPopupCustomerName(c.companyName || c.name || "");
                              setPopupCustRecord(c);
                              setPopupCustSuggestions([]);
                            }}
                            style={{ padding:"8px 12px", cursor:"pointer", fontSize:12,
                              color:"#f1f5f9", borderBottom:"1px solid #374151" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#2d3748"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <strong>{c.companyName || c.name}</strong>
                            {c.country && <span style={{ color:"#6b7280", marginLeft:6 }}>{c.country}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {parsePopup.data.vin          && <div><span style={{ color:"var(--text-muted)" }}>VIN: </span><strong style={{ fontFamily:"monospace" }}>{parsePopup.data.vin}</strong></div>}
              {(parsePopup.data.year||parsePopup.data.make) && <div><span style={{ color:"var(--text-muted)" }}>Vehicle: </span><strong>{[parsePopup.data.year,parsePopup.data.make,parsePopup.data.model].filter(Boolean).join(" ")}</strong></div>}
              {parsePopup.data.pickupLocation && <div><span style={{ color:"var(--text-muted)" }}>Pickup: </span><strong>{parsePopup.data.pickupLocation}</strong></div>}
              {parsePopup.data.pod           && <div><span style={{ color:"var(--text-muted)" }}>Destination: </span><strong>{parsePopup.data.pod}</strong></div>}
              {parsePopup.data.shippingLine  && <div><span style={{ color:"var(--text-muted)" }}>Shipping Line: </span><strong>{parsePopup.data.shippingLine}</strong></div>}
              {parsePopup.data.towingQuote   && <div><span style={{ color:"var(--text-muted)" }}>Towing Quote: </span><strong style={{ color:"#34d399" }}>${parsePopup.data.towingQuote}</strong></div>}
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button type="button"
                onClick={() => {
                  applyParsedData(
                    {
                      ...parsePopup.data,
                      customerName:   popupCustomerName || parsePopup.data.customerName,
                      customerRecord: popupCustRecord   || parsePopup.data.customerRecord,
                    },
                    popupType, popupContainerSize, popupWarehouse
                  );
                  setParsePopup(null);
                }}
                style={{ flex:1, padding:"10px 0", borderRadius:8, border:"none",
                  background:"#059669", color:"#fff", cursor:"pointer", fontWeight:700, fontSize:14 }}>
                ✓ Apply to Order
              </button>
              <button type="button" onClick={() => setParsePopup(null)}
                style={{ padding:"10px 18px", borderRadius:8, border:"1px solid var(--border)",
                  background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {newCustPopup && (
        <div className="modal-backdrop" onClick={() => { setNewCustPopup(null); setCustChoice(null); setCustSearch(""); }}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
            <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", color: "var(--accent)" }}>
              {newCustPopup.isExisting ? "Customer Found" : "New Buyer Name"}
            </div>
            <h2 style={{ margin: "0 0 6px" }}>{newCustPopup.name}</h2>

            {/* Choice screen for truly new customers */}
            {!newCustPopup.isExisting && !custChoice && (
              <>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 18 }}>
                  This buyer name isn't in the address book. What would you like to do?
                </p>
                <div style={{ display:"flex", gap:10, marginBottom:8 }}>
                  <button type="button" onClick={() => setCustChoice("new")}
                    style={{ flex:1, padding:"12px 0", borderRadius:8, border:"none",
                      background:"#059669", color:"#fff", cursor:"pointer", fontWeight:700, fontSize:13 }}>
                    ➕ New Customer
                  </button>
                  <button type="button" onClick={async () => {
                    setCustChoice("existing");
                    setCustSearch("");
                    setCustSearchLoading(true);
                    const res = await fetch(`${API}/api/address-book?type=customer`);
                    const data = await res.json();
                    setCustSearchResults(Array.isArray(data) ? data : []);
                    setCustSearchLoading(false);
                  }}
                    style={{ flex:1, padding:"12px 0", borderRadius:8, border:"none",
                      background:"#2563eb", color:"#fff", cursor:"pointer", fontWeight:700, fontSize:13 }}>
                    🔗 Add to Existing Customer
                  </button>
                </div>
                <button type="button" onClick={() => { setNewCustPopup(null); setCustChoice(null); }}
                  style={{ width:"100%", padding:"8px 0", borderRadius:8, border:"1px solid var(--border)",
                    background:"var(--bg-panel)", color:"var(--text-muted)", cursor:"pointer", fontSize:12 }}>
                  Skip for Now
                </button>
              </>
            )}

            {/* Add to existing customer — searchable picker */}
            {!newCustPopup.isExisting && custChoice === "existing" && (
              <>
                <p style={{ fontSize:13, color:"var(--text-muted)", marginTop:0, marginBottom:12 }}>
                  Search for the customer to link <strong>{newCustPopup.name}</strong> to:
                </p>
                <input
                  autoFocus
                  placeholder="Search customers…"
                  value={custSearch}
                  onChange={e => setCustSearch(e.target.value)}
                  style={{ width:"100%", marginBottom:10, boxSizing:"border-box" }}
                />
                <div style={{ maxHeight:260, overflowY:"auto", display:"flex", flexDirection:"column", gap:4, marginBottom:12 }}>
                  {custSearchLoading && <div style={{ fontSize:13, color:"var(--text-muted)", padding:8 }}>Loading…</div>}
                  {!custSearchLoading && custSearchResults
                    .filter(c => !custSearch || (c.companyName||"").toLowerCase().includes(custSearch.toLowerCase()))
                    .map(c => (
                      <button key={c._id} type="button"
                        onClick={async () => {
                          // Append buyer name to this customer
                          await fetch(`${API}/api/address-book/${c._id}/add-buyer`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ buyerName: newCustPopup.name }),
                          });
                          // Update form with this customer's info
                          const pod  = c.defaultPod || "";
                          const line = podToShippingLine(pod);
                          setForm(prev => ({
                            ...prev,
                            customerName:  c.companyName || prev.customerName,
                            customerPhone: c.phone       || prev.customerPhone,
                            customerEmail: c.email       || prev.customerEmail,
                            buyerName:     newCustPopup.name,
                            source:        c.defaultOffice || "USA OFFICE",
                            ...(pod  ? { pod }                : {}),
                            ...(line ? { shippingLine: line } : {}),
                          }));
                          if (pod) {
                            try {
                              const rates = await fetch(`${API}/api/pricing?type=towing`).then(r => r.json());
                              const cityN = normCity(form.pickupCity || "");
                              const match = rates.find(r => r.port && normCity(r.city) === cityN) ||
                                rates.find(r => r.port && r.name && cityN && normCity(r.name).includes(cityN));
                              const port = match?.port || (form.pickupState && stateToPort[form.pickupState.toUpperCase()]);
                              if (port) await handlePolChange(port.toUpperCase(), line);
                            } catch {}
                          }
                          setNewCustPopup(null); setCustChoice(null); setCustSearch("");
                        }}
                        style={{
                          textAlign:"left", padding:"10px 14px", borderRadius:8, cursor:"pointer",
                          border:"1px solid var(--border)", background:"var(--bg-panel)",
                          color:"var(--text-primary)", fontSize:13,
                        }}>
                        <strong>{c.companyName}</strong>
                        {c.defaultPod && <span style={{ marginLeft:8, fontSize:11, color:"var(--text-muted)" }}>{c.defaultPod}</span>}
                        {(c.buyerAccounts||[]).length > 0 && (
                          <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:2 }}>
                            Buyers: {(c.buyerAccounts).join(", ")}
                          </div>
                        )}
                      </button>
                    ))
                  }
                </div>
                <button type="button" onClick={() => setCustChoice(null)}
                  style={{ fontSize:12, color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>
                  ← Back
                </button>
              </>
            )}

            {/* New customer form OR existing customer update */}
            {(newCustPopup.isExisting || custChoice === "new") && (
              <>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 18 }}>
                  {newCustPopup.isExisting
                    ? "No shipping destination saved for this customer yet. Set it now so future orders auto-fill."
                    : "Add contact info and shipping destination so future orders auto-fill."}
                </p>

            <label style={{ display: "block", marginBottom: 12 }}>
              Phone / WhatsApp
              <input
                value={newCustPopup.phone}
                onChange={e => setNewCustPopup(p => ({ ...p, phone: e.target.value }))}
                placeholder="+1 555 000 0000"
                style={{ marginTop: 6 }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 12 }}>
              Email
              <input
                type="email"
                value={newCustPopup.email}
                onChange={e => setNewCustPopup(p => ({ ...p, email: e.target.value }))}
                placeholder="customer@email.com"
                style={{ marginTop: 6 }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 20 }}>
              Ships To (Destination Port)
              <select
                value={newCustPopup.defaultPod}
                onChange={e => setNewCustPopup(p => ({ ...p, defaultPod: e.target.value }))}
                style={{ marginTop: 6, width: "100%", padding: "8px 10px", borderRadius: 6,
                  border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)" }}>
                <option value="">— Unknown —</option>
                <option value="LAGOS">🇳🇬 Lagos, Nigeria</option>
                <option value="TEMA">🇬🇭 Tema, Ghana</option>
                <option value="COTONOU">🇧🇯 Cotonou, Benin</option>
                <option value="LOME">🇹🇬 Lomé, Togo</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={async () => {
                // Save or update address book record with defaultPod
                if (newCustPopup.isExisting && newCustPopup.recordId) {
                  await fetch(`${API}/api/address-book/${newCustPopup.recordId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ defaultPod: newCustPopup.defaultPod }),
                  }).catch(() => {});
                } else {
                  await fetch(`${API}/api/address-book`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      companyName: newCustPopup.name,
                      phone:       newCustPopup.phone,
                      email:       newCustPopup.email,
                      defaultPod:  newCustPopup.defaultPod,
                      type:        "customer",
                    }),
                  }).catch(() => {});
                }
                // Apply to form + auto-fill POD/shipping line/delivery
                const pod  = newCustPopup.defaultPod;
                const line = podToShippingLine(pod);
                setForm(prev => ({
                  ...prev,
                  customerPhone: newCustPopup.phone || prev.customerPhone,
                  customerEmail: newCustPopup.email || prev.customerEmail,
                  ...(pod  ? { pod }                : {}),
                  ...(line ? { shippingLine: line } : {}),
                }));
                // Look up delivery port directly from pricing — bypass stale closure issue
                if (pod) {
                  try {
                    const rates = await fetch(`${API}/api/pricing?type=towing`).then(r => r.json());
                    const cityN = normCity(form.pickupCity || "");
                    const match = rates.find(r => r.port && normCity(r.city) === cityN) ||
                      rates.find(r => r.port && r.name && cityN && normCity(r.name).includes(cityN));
                    const port = match?.port || (form.pickupState && stateToPort[form.pickupState.toUpperCase()]);
                    if (port) await handlePolChange(port.toUpperCase(), line);
                  } catch (e) { console.error("Delivery lookup failed", e); }
                }
                setNewCustPopup(null); setCustChoice(null);
              }}>
                Save Contact Info
              </button>
              <button onClick={() => { setNewCustPopup(null); setCustChoice(null); }}
                style={{ background: "var(--bg-panel)", color: "var(--text-muted)" }}>
                Skip for Now
              </button>
            </div>
            </>
            )}{/* end new/existing form */}
          </div>
        </div>
      )}
    </div>
  );
}