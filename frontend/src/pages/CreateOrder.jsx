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

  // ── New customer contact popup ─────────────────────────────────────────
  const [newCustPopup, setNewCustPopup]     = useState(null); // { name, phone, email, defaultPod }

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

  const suggestDeliveryFromPickupCity = async (city, shippingLineHint, state) => {
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
        const lineHint = getShippingLineForPort(port, form.pod) || shippingLineHint;
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
        if (Array.isArray(r2) && r2.length) picked = r2[0];
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


  // ── Buyer Receipt handler ──────────────────────────────────────────────
  const handleBuyerReceiptFile = async (file) => {
    if (!file) return;
    setBrFile(file);          // keep file reference for upload after order creation
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

      // Pop up for new customers OR existing customers with no defaultPod saved yet
      const rec = data.customerRecord;
      if (data.customerName && (!data.customerFound || (data.customerFound && !rec?.defaultPod))) {
        setNewCustPopup({
          name:       rec?.companyName || data.customerName,
          phone:      rec?.phone       || data.customerPhone || "",
          email:      rec?.email       || data.customerEmail || "",
          defaultPod: rec?.defaultPod  || "",
          isExisting: !!data.customerFound,
          recordId:   rec?._id || null,
        });
      }

      // Auto-fill form fields from parsed receipt
      // Use stored defaultPod first (set when customer was first added), fall back to country
      const podFromCustomer = rec?.defaultPod || countryToPod(rec?.country);
      setForm((prev) => ({
        ...prev,
        // Customer info — use stored record when found, fall back to parsed PDF data
        customerName:  rec?.companyName  || data.customerName  || prev.customerName,
        customerPhone: rec?.phone        || data.customerPhone || prev.customerPhone,
        customerEmail: rec?.email        || data.customerEmail || prev.customerEmail,
        buyerName:     data.buyerName    || prev.buyerName,
        // Buyer / Consignee — fill from parsed receipt address block
        consigneeName:    data.consigneeName    || data.buyerName || data.customerName || prev.consigneeName,
        consigneeAddress: data.consigneeAddress || prev.consigneeAddress,
        consigneeCity:    data.consigneeCity    || prev.consigneeCity,
        consigneeCountry: data.consigneeCountry || prev.consigneeCountry,
        // Vehicle
        vin:       data.vin       || prev.vin,
        year:      data.year      || prev.year,
        make:      data.make      || prev.make,
        model:     data.model     || prev.model,
        lotNumber: data.lotNumber || prev.lotNumber,
        // Pickup
        pickupLocation: data.pickupName    || data.pickupLocation || prev.pickupLocation,
        pickupName:     data.pickupName    || prev.pickupName,
        pickupAddress:  data.pickupAddress || prev.pickupAddress,
        pickupCity:     data.pickupCity    || prev.pickupCity,
        pickupState:    data.pickupState   || prev.pickupState,
        pickupZip:      data.pickupZip     || prev.pickupZip,
        // Default POD + shipping line from customer's country (only when found in address book)
        ...(podFromCustomer                      ? { pod:          podFromCustomer                      } : {}),
        ...(podToShippingLine(podFromCustomer)   ? { shippingLine: podToShippingLine(podFromCustomer)   } : {}),
      }));

      // Decode VIN if we got one
      if (data.vin && data.vin.length === 17) decodeVin(data.vin);

      // Auto-suggest delivery port from towing charges (RORO only)
      if ((data.pickupCity || data.pickupState) && form.requestType === "RORO") {
        suggestDeliveryFromPickupCity(data.pickupCity, podToShippingLine(podFromCustomer), data.pickupState);
      }
    } catch (err) {
      console.error("Buyer receipt parse error:", err);
      setBrResult({ error: err.message });
    } finally {
      setBrParsing(false);
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

    // If buyer receipt was uploaded during parsing, save it to the order documents now
    if (brFile && data._id) {
      setMessage(`✅ Order ${data.refNumber} created — uploading buyer receipt…`);
      try {
        const fd = new FormData();
        fd.append("file",  brFile);
        fd.append("label", "Buyer Receipt");
        const upRes = await fetch(`${API}/api/orders/${data._id}/upload-drive`, {
          method: "POST",
          body:   fd,
        });
        if (!upRes.ok) throw new Error("Upload returned " + upRes.status);
        setMessage(`✅ Order ${data.refNumber} created — buyer receipt saved to documents.`);
      } catch (upErr) {
        console.error("Buyer receipt upload failed:", upErr);
        setMessage(`✅ Order ${data.refNumber} created — buyer receipt upload failed (add it manually in the order).`);
      }
      setBrFile(null);
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
        <div className="dashboard-card">
          <span>Order Type</span>
          <strong>{form.requestType}</strong>
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
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 6 }}>
                Order Number
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="text"
                  value={manualRef}
                  onChange={e => setManualRef(e.target.value)}
                  style={{
                    width: 130, padding: "8px 12px", borderRadius: 8, fontSize: 20, fontWeight: 700,
                    background: "var(--bg-input)", border: "2px solid #1a6ef7",
                    color: "#60a5fa", outline: "none", textAlign: "center",
                  }}
                />
                {manualRef !== nextRef && (
                  <button type="button" onClick={() => setManualRef(nextRef)}
                    style={{ fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                    Reset to {nextRef}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                Auto-generated · editable if needed
              </div>
            </div>
          </div>
        </section>

        {/* ── Buyer Receipt Drop Zone ───────────────────────────────────── */}
        <section className="form-section" style={{ paddingBottom: 0 }}>
          <h2 style={{ marginBottom: 10 }}>Buyer Receipt (Auto-Fill)</h2>
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
              border: `2px dashed ${brDragging ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "18px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: brDragging ? "rgba(99,102,241,0.07)" : "var(--bg-panel)",
              color: "var(--text-secondary)",
              fontSize: 13,
              transition: "all 0.15s",
              marginBottom: 10,
            }}
          >
            {brParsing
              ? "⏳ Parsing buyer receipt…"
              : "📄 Drop Buyer Receipt PDF here or click to upload — auto-fills customer, VIN & pickup"}
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

          {/* Parsed success strip */}
          {brResult && !brResult.error && (
            <div style={{
              background: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.35)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#6ee7b7",
              marginBottom: 8,
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}>
              <span>✅ Parsed</span>
              {brResult.customerName && <span><strong>Customer:</strong> {brResult.customerName}</span>}
              {brResult.vin          && <span><strong>VIN:</strong> {brResult.vin}</span>}
              {brResult.pickupName   && <span><strong>Pickup:</strong> {brResult.pickupName}{brResult.pickupCity ? `, ${brResult.pickupCity}` : ""}</span>}
            </div>
          )}

          {/* Parse error */}
          {brResult?.error && (
            <div style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#fca5a5",
              marginBottom: 8,
            }}>
              ❌ Parse error: {brResult.error}
            </div>
          )}

          {/* Customer NOT found — small reminder (popup already fired) */}
          {brCustomerFound === false && brResult?.customerName && !newCustPopup && (
            <div style={{
              background: "rgba(245,158,11,0.10)",
              border: "1px solid rgba(245,158,11,0.35)",
              borderRadius: 8, padding: "10px 14px", fontSize: 13,
              color: "#fcd34d", marginBottom: 8,
            }}>
              ⚠️ New customer — will be added to address book on save.
            </div>
          )}

          {/* Customer FOUND confirmation */}
          {brCustomerFound === true && brResult?.customerName && (
            <div style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#a5b4fc",
              marginBottom: 8,
            }}>
              ✔ Customer "{brResult.customerName}" found in address book — contact info auto-filled.
            </div>
          )}
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
                  update("requestType", newType);
                  // If switching to RORO and pickup city is already known, suggest delivery
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

            <label>
              Shipping Line
              <select
                value={form.shippingLine}
                onChange={(e) =>
                  update("shippingLine", e.target.value)
                }
              >
                <option value="">Choose...</option>
                <option>ACL</option>
                <option>SALLAUM</option>
              </select>
            </label>

            <label style={{ gridColumn: "1 / -1" }}>
              Port of Loading
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {["BALTIMORE","JACKSONVILLE","PROVIDENCE","FREEPORT","WILMINGTON","BRUNSWICK","NEWARK"].map(p => (
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
      {newCustPopup && (
        <div className="modal-backdrop" onClick={() => setNewCustPopup(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
            <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", color: "var(--accent)" }}>
              {newCustPopup.isExisting ? "Customer Found" : "New Customer"}
            </div>
            <h2 style={{ margin: "0 0 6px" }}>{newCustPopup.name}</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 18 }}>
              {newCustPopup.isExisting
                ? "No shipping destination saved for this customer yet. Set it now so future orders auto-fill."
                : "New customer — add their contact info and shipping destination so future orders auto-fill."}
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
                setNewCustPopup(null);
              }}>
                Save Contact Info
              </button>
              <button onClick={() => setNewCustPopup(null)}
                style={{ background: "var(--bg-panel)", color: "var(--text-muted)" }}>
                Skip for Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}