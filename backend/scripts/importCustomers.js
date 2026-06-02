/**
 * importCustomers.js
 * Run: node backend/scripts/importCustomers.js
 * Parses the raw customer list and upserts into AddressBook (type: "customer").
 * Skips duplicates by companyName (case-insensitive).
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const AddressBook = require("../models/AddressBook");

// ── Raw customer data ─────────────────────────────────────────────────────────
const RAW = `A-IBM MOTORS NIG LTD
IBRAHIM HAMZA
A.IBMMOTORS@gmail.com	2348031333111
$394.00


$394.00 overdue


AA kurmawa Automobiles
Auwal Ahmad
aakurmawaautomobiles@gmail.com	2347032842386


ABAYOMI OSUNSANYA
YOMI
MOSUNSANYA@GMAIL.COM	8572505476


ABBA ABDULLAHI NASIRU
MAMMANNASIRABBBA@GMAIL.COM


ABBAS AUTOMOBILE CONTRACTORS LTD
ABBAS TUKUR TIJJANI
abbasautomobilecontractorsltd@gmail.com	2348036964774


ABBASTECH NIGERIA LTD
ABBAS ABUBAKAR
abbastech10@yahoo.com	+234 8037874826
$470.00


$470.00 overdue


ABDULAKEEM OLARENWADU YUSUF
AKYAUTOS@GMAIL.COM


ABDULHADI YALO
YLO_78@yahoo.co.uk	3472588767


Abdullahi Baffa
aabaffa1@yahoo.com	234 803 347 3516
$65,430.00


$39,925.00 overdue


Abdullahi Bello
bunuku70@gmail.com	2348028619600


ABK GLOBAL
ABUBAKAR SALISU ADAMU
AbkGLOBALMOTORS2019@GMAIL.COM


ABROKYIREABA-GH LIMITED
seanmarnet@yahoo.com


ABUBAKAR BALA
BAADJ.AB98@gmail.com	2347030152936
$5,200.00


$5,200.00 overdue


ABUBAKAR MUHAMMAD
smisauit@gmail.com
$3,830.00


$3,830.00 overdue


ADAM IBRAHIM
ADAMSIB96@GMAIL.COM	2348035097535


ADESOYE TAYE MUSIBAU
adesoyetaye@gmail.com	08171003672
$80.00


$80.00 overdue


ADEYINKA AUTO VENTURES
ERIC
erickofi.adeyinka@yahoo.com
$5,000.00


$5,000.00 overdue


AET GLOBAL LOGISTICS
aetgloballogistics@yahoo.com	8329238711


AFOTEK GLOBAL CONSTRUCTION
EddieKraku@gmail.com


AFUA SARPONG
PRISARPP@YAHOO.COM	3472847941


Ahmed Salim Bawa
Ahmedbsalim@hotmail.com	2348033657572


AKEENKE HOLDINGS LLC
OGUNSINA
ogunsina.adeyeye@yahoo.com	6512148814


Akoto K. Osei
andykofi20@gmail.com


AKY AUTOS AND LOGISTICS


AL FIRJ WIDE LIMITED
MURAD & BROTHERS
7brothersglobal@gmail.com
$12,675.00


AL HAKIM DYNAMIC VENTURES
MUSTAPHA KANYA
Alhakimdynamic@yahoo.com	2349083848044


AL-KHALIL GENERAL MERCANTS
ALIYU HALILU NAKAKA


ALAS SUPER MARKET
LAWAL LAWAL
lawallawal70@gmail.com	2348039275749


AMEER & AMEERAH AUTO HANDLERS
ameerandameera20@gmail.com
$7,950.00


$7,950.00 overdue


AMINU SULE KOKI
HANIEE BUSINESS ENTERPRISES
ASULEKOKI@GMAIL.COM	2348066359795


AMIS GLOBAL LTD
KELVIN ENTSUAH MENSAH
kemensah@amis-global.org	233208912693


ANENE ANTHONY
toniecoxe@yahoo.com	2348023525278


ANTHONY ARTHUR
ANTHONY.M.ARTHUR@GMAIL.COM	7735248170


ASMAHU MEMORIAL VENTURE
ISMAIL BADASMI
wbadamasi@gmail.com


AUCTION PAYMENT


AUTOBLOCK LIMITED
FRANK ADDO


AY Kura auto and investment limited
ABUBAKAR YA'U KURA
AYKAUTOINVEST@gmail.com


AYMAN AUTOMOBILE SVCS NIG
NANA KHADIJA
NANAKHADIJAADAM6969@gmail.com
$2,500.00


$2,500.00 overdue


AZEEMA IMPORTS AND EXPORTS
FATIHU ALHASAN
FATIHU2012@GMAIL.COM	2347033100000


BAFSA GLOBAL VENTURES
BAFSAGLOBALVENTURES1@GMAIL.COM
$35,580.00


$16,955.00 overdue


BALA HARUNA
balaharunamsa@gmail.com


BASHIR JALLAH NUHU
BASHIR JALLAH
BASHNJALLAH@GMAIL.COM
$3,110.00


$3,110.00 overdue


BEATRICE KWAO


BELLO USMAN
busman1133@gmail.com


BENJAMIN NELSON


BERNARD EWOOL
ALL SPECS VENTURES
ekownab@hotmail.com	233208999338


Blessing Isiguzo
blessingisiguzo@yahoo.com	5185127681


BOSS215 LLC
BENJAMIN NELSON
benjaminnelson39@gmail.com	2676705946


BRIGHT ACQUAAH
ACQUAAHBRIGHT@YAHOO.COM	+447498591077
$1,775.00


$1,775.00 overdue


BRIGHT BOATENG
banny2sam@yahoo.co	3477259837


BUNCHVIEW NIGERIA LTD
GAZZALI UBA JAJI
algazzaliuj@gmail.com


CARSHARKS
EVAN WEINSTEIN
EVAN.CARSHARKS@GMAIL.COM	9177315287


CHARLES WILSON
don43pablo@gmail.com	8595517723


CHRAVE PARTNERS LIMITED
CHRIS VAN-LARE
chrisvanlare1@gmail.com


CHRIS JENNINGS


CHUBUNAWA MOTORS
FARUK
faruk2606@gmail.com
$2,990.00


$2,990.00 overdue


COBYWAN CONSULT LIMITED
DANIEL OFORI


CORECRETE LTD
CHEIDO OKORO
cdozie@gmail.com


DAKE VENTURES RESOURCES LTD.
ABDULRAHAM ALIYU DALA
skynetforreal@gmail.com


DANIEL MORTON
Danielmorton@jrmorton.net
$7,450.00


$7,450.00 overdue


DANIEL OKAFOR


Danvesther Inc
Abiodun Olanrewaju
danvesther@comcast.net	713-819-8126


DAVID GEORGE
dgeorge7478@gmail.com	+234 802 3079 286


DAYYIB GLOBAL RESOURCES
ABDULRASHEED
IBRAHEEM4ABDUL@gmail.com
$3,135.00


$3,135.00 overdue


DEBRAH KWAKU JOSHUA
+233243971183


DELALI AFEDO
$39,744.00


$39,744.00 overdue


DESMOND GBEDDY
$7,200.00


$315.00 overdue


DOUBLE G AUTO
FRANK
FRANKADE2K@yahoo.co.uk	2407130632


EDENKEN SHOWERS
EDENkenshowers.autos@yahoo.com


Edrick Automotive and Trading
MICHAEL TAAH JUNIOR
MICKe2118244@gmail.com


EDWARD OSEI
nanakwame3177@gmail.com	5083733422


ELPY ENTERPRISE
VANNEL MAWULI DZIGBA
vanneld@abosseyokaionline.com.gh	233242829552


Emmanuel Atsugah
Kamenghauto247@yahoo.com	6143955284
$105.00


$105.00 overdue


EMMANUEL BAKA
jamesbaka10@gmail.com	+233 55 291 4439


Emmanuel Maduabuchi Ugochukwu
EMMXUGO@GMAIL.COM


EMMANUEL NYAME
Nananyame2004@yahoo.com	6143027859


EON83 ENTERPRISE
EZEKIEL NYAME


EVAN AND LEORA HERTAN
EVAN HERTAN
EVAN.HERTAN@GMAIL.COM	9173649802


EVANS TEYE FAYORSEY
DEYTIME05@GMAIL.COM


EWRIC INTEGRATED RESOURCES LTD
ERIC EDOMWONYI
ERIC.EDOMWONYI@YAHOO.COM	9292610426


FRANCIS AGBALI
fagbali@fudutsinma.edu.ng


GALADI MOTORS & GEN MERCH LTD
GALadimotors@gmail.com


GEFFOUR AIR CARGO AUTO SALES
RUDOLPH
deytime05@gmail.com


GIRONA AUTO NIGERIA LIMITED
NWOKO EMMAUNEL
emma.gsat@yahoo.com


GLORIA KORLEY


Godspower Ubani
gusubani@hotmail.com	518 269 2152


HADI MUSA
HADImiliasu@gmail.com
$1,630.00


$1,630.00 overdue


HAJ MASHIDA ENTERPRISES
KABIRU UBALE
k.ubale@yahoo.com	2348067512396
$1,410.00


$1,410.00 overdue


HAMHAD AUTOMOBILE
HADII ZAKARIAH
ZAKHADMOH@gmail.com


HARISU NAFIU
HARISUnafiu@gmail.com


HASSAN DARMA
sanihassanmotors@gmail.com


HAYDAYS EKN VENTURES
EMMANUEL KWAKU NYARKO
BONELOVE83@GMAIL.COM	233209090555


HIGHSEA GENERAL MARCHANT
AHMAD SANI MUSA
ADAUra8@gmail.com	+2348035188115
$8,325.00


$8,325.00 overdue


HOBORT SHIPPING AND LOGISTICS
JEFFERY HOGGAR
INFO@HOBORTSHIPPING.COM	4045434422


Horizon Auto Logistics
JOHN WHITE
john.white@horizonautologistics.com	(904) 945-1090


IBRAHAB AUTOS CO
IBRAHIM MUSA ABDU
IBRAHIMMK2005@GMAIL.COM	3478498749


IBRAHIM MUSTAFA
UAM CUBE LIMITED


Ice Global Services
ISAAC EWENI
ICEHOLDINGSe@yahoo.com


Ihdab Enterprise Nigeria
HABIB DANLAMI
HABIBDANLAMI976@GMAIL.COM	+22967834955


IRIKEFE OGAGA
KEFE7358@gmail.com


ISHOLA INTEGRATED FARMS
BINTA ISHOLA
isholaintergratedfarms@gmail.com	2348033760274
$1,690.00


$1,690.00 overdue


ISMAEL GBADAMASI


ISRAEL TEYE SACKITEY
sackiteyi@yahoo.com	+233243658755
$3,098,821.67


$2,943,711.67 overdue


JAX AUTOGO
ZAKHIA MATTA
Jaxautogollc@gmail.com	6175433458
$1,200.00


$1,200.00 overdue


JEFFERY HOGGAR
4045434422


JEJE OLOWU
JEJE OLOWU
3472512745


JIMOH GARBA
GBENGA OGUNTUASE
gbenga.oguntuase2018@gmail.com	2348039434355


JOHN AGOSTA
7327404141


JOHN DZANDZA
JOHNDZANDZA@gmail.com


JOSEPH GYIMAH
djjoeg@yahoo.com


JOSEPH OFOSU
JOSEPH OFOSU
J.OFOSU@ymail.com


JOZZVIN AUTO ENTERPRISE
JOSEPHINE NUAMAH
jozzyautos@gmail.com


JUMGLOBAL AUTOS
SERIFAT OLAJUMOKE BISUGA
jumglobalautos@gmail.com	2812585113


Justin Ezeugo
REVJustin.ezeugo@gmail.com


K&J TRANSPORT
KOJO
KJ.TRANSPORTGROUP@yahoo.com	4133458196


KABANA'S AUTOMOTIVES
RICHARD JOSEPH BARNES


Kabiru Ahmadu
ahmaduyaks@gmail.com	2349099303333


KAMSAY CONSTRUCTION
KABO SALISU
SALISU.KABO@yahoo.com
$3,190.00


$3,190.00 overdue


KATFOREX GLOBAL SYNERGY LIMITED
KATFOREXGLOBALSYNERGYLIMITED@GMAIL.COM


KEB WAY ENTERPRISE
Ernest Kwabena Boateng
kwabenaernestb@gmail.com	233242041739


KELVIN DOMFEH
kkdomfeh@yahoo.com
$1,500.00


$1,500.00 overdue


KEN DAVID
PASTORKENDAVID@GMAIL.COM	2148669364


KHAIRUL ANAM VENTURES
Almustapha Salisu Muhammad
almustaphakabo@yahoo.com	2348142648468


KOFI BAMFO
COFF95@GMAIL.COM


Korantenger depot
EN2020214515@gmail.com


KT ALMADINA MOTORS INT.


LEASERITEINTE
TZVI KATZ
STEVE@LEASERITEAUTO.COM


LEONIDAS VENTURES
JAMES DARE
leonidasauto1@gmail.com
$39,880.00


$39,880.00 overdue


LESLIE SACKEY
l.sackey2@gmail.com	233264790846
$1,525.00


$1,525.00 overdue


MADON TANKO INTERNATIONAL
OMAR RABIU


MAIDUGURI MOTORS LTD
MAIDYGURIMOTORSLTD@GMAIL.COM	2348023548740
$10,445.00


$10,445.00 overdue


MARAFCO UNIVERSAL CONCEPT
ABDULLAH A ANKA
bnabbas2006@yahoo.com	3479636014


MASOKANO INVESTMENT NIG LTD
BMAsokano@yahoo.com


McJefferson Auto Investment
MCJEFFERSONINVESTMENTS@gmail.com	(832) 352-9600


MELODY DANESHRAD


METHODE KWETE
METHODEBOPE@YAHOO.FR	2085701013


MIKA MOTORS
MIKAMOTORS98@GMAIL.COM	08108638389


MIKO AHMAD YAKASAI ENTERPRISE


MM MUBY GENERAL ENTERPRISE
MUBARAK MURTALA
MMMUBY1@GMAIL.COM


MNM AUTOMOBILES NIG LTD
Musa Nuhu Musa
ms_nuhu@yahoo.com	2348033478222
$44,750.00


$36,685.00 overdue


MORRIS AFOKO
morrisafoko@yahoo.com


MUDASSIR SANI
MUDASSIR SANI
MUDASsirsani179@yahoo.com
$2,635.00


$2,635.00 overdue


MUSAB LOGISTIC SOLUTIONS
NANAKHADIJAADAM6969@GMAIL.COM	+2348034247491


MUTANDA AUTOVILLE LTD
HUSSAINI MUHAMMAD
hkmazugal@yahoo.co.uk


NANA BOATENG ADOMAKO
NANABOATENGADOMAKO@YAHOO.COM	6467857718
$3,100.00


$3,100.00 overdue


NBB AUTOMOBILES
TASIU NABABA
NBBAUTOMOBILE@yahoo.com
$4,455.00


$4,455.00 overdue


NI GLOBAL INVESTMENTS LTD
nisahkt@gmail.com	601110721219
$75.00


$75.00 overdue


NII XPLAXH
Andrew Laryea
tramnoauto@gmail.com


Noor high tech general
Nuhu isah
nuhuisah33g@gmail.com
$6,660.00


$6,660.00 overdue


NTY GLOBAL ASS
Abelurasheed isyaku Oyeniyi
alh.isyakumotors@yahoo.com


NUBEL INTERGATED SERVICES
NURA BELLO
nura.abello@gmail.com


NURIEL KLINGER
nuri.klinger@gmail.com	6144770202


NURUDEEN TUNDE YAHAYA
nuraty@gmail.com	+2348033072769
$32,107.50


$28,162.50 overdue


NUSAIB AUTOMOBILE VENTURES
SILENTZONE85@GMAIL.COM	+2348060297770
$49,335.00


$18,305.00 overdue


OLAJOSHUA VENTURES
JOSHUA SEGUN OLAWUNMI
alabitoyosi1616@gmail.com	2347064191538


OPEYEMI MAYOWA AFOLABI
HAMZAALIYU666@gmail.com
$1,595.00


$1,595.00 overdue


OVERSEAS SHIPPING
MUHAMMAD


OWARE CAESAR KWABENA
CAESAR
OWARE.CAESAR.KWABENA@gmail.com	233246507620


OYEDELE BOLUMOLE
DELE BOLUMOLE
dfbjesu@gmail.com	2349098869891


PAUL NORMAN GUENTHER
paulguenther213@outlook.com	9712771149


PETER ONYEANULA
PETDIANYI@GMAIL.COM	6783609602


PHILIP OPOKU-ASANTE
CruiseaidAuto@outlook.com	233244247166


Philkud Autoworld Ventures
philip
Philkudauto@gmail.com	233555594170


PHOKOS MOTORS
ERIC DANSO
eric.kdanso@yahoo.com


Premier Freight Logistics
pflogistics@outlook.com	233244566344


PRINCE OSEI WIAFE
ULTRARIDE.AUTOPARTS@GMAIL.COM
$53,730.00


$53,730.00 overdue


RACHELLI HELLER
786-985-7509


RASAC IMPEXT AND INVESTMENT
ALIYU MUSA


RAUDA MOTORS LTD
ALHAJI USMAN MOHAMMAD
RAUDAUSMAN10@gmail.com	2348036368606
$4,800.00


$4,800.00 overdue


RAYMAD AUTOMOBILES NIG
lawalkabir35@gmail.com
$6,160.00


$6,160.00 overdue


RBS NIGERIA LTD
RBSLTD22@gmail.com
$695.00


$695.00 overdue


RICHARD JOSEPH BARNES
RICHARDbarnes72@icloud.com


ROCGLOBAL OPTIMUM SERVICES
ABDULRASHEED
DAYYIBGLOBAL@GMAIL.COM


Rockarm Ventures
ROCKSONAKUMBA@GMAIL.COM	233208956443


RUTHY GEWARITZ


SAAD AS AND TECH LTD
SAAD ABDULRAHMAN UMAR
saadyumar14@gmail.com


SADIQ MIKAIL
SADIQ MIKAIL
SADIK212@live.com
$6,280.00


Sadiq SOLO AUTO PARTS INC
SADIQHASSAN55021@GMAIL.COM


SAKAL ENTERPRISE
ALFREDSAKYI89@gmail.com
$3,150.00


$3,150.00 overdue


SALISU ADAMU YUSUF
SBB3660@GMAIL.COM	2348036608178


SALLUM LINES


SAMBO-DONGA DONZOMGA
DR SAMBO
DANDONGA2@GMAIL.COM


SAMINU NABABA
SM NABABA SYNERGY LTD
nsaminu@gmail.com
$5,410.00


$5,410.00 overdue


SANI HASSAN MOTORS
sanihassanmotors@gmail.com
$30,887.00


$23,757.00 overdue


SASI GROUP OF COMPANIES
TIM DUFU SASI
TIMOTHYSASI@YAHOO.COM	233208845087
$21,180.01


$8,695.01 overdue


SE AUTOS
Samuel Quansah Ofei
SAMMYOFEI@yahoo.com


SHAMSU SANI DANMASHI
shamsucars@gmail.com	2349044824343


SHEHU BARKINDO
SBARKINDO@yahoo.com	2348032408078
$9,165.00


$9,165.00 overdue


SHMUEL GOLDSTEIN
SHMUEL@SLOPEREALTY.COM	8453413825


SICO LINE
SAAD
shipping@sicoline.com	2015233510


SK GLOBAL
NIYI
SETHSUNDAY@LVE.COM


SLICK AUTO COMPANY LTMD
SETH YEBOAH
broadwayautosdome@gmail.com	8047986091


Snude Auto World Limited
SUNDAY NNAJIUDE
sundaynnajiude@gmail.com	2348033221222


SOCO AUTO VENTURES
MARK SOMUAH
marksomuah1@gmail.com	233504522170


SOLTARA ENERGY
Olatomiwa Idowu


Steindale Enterprise
EVANS OWIREDU
Esteindale@gmail.com	7863992035


STEVEN KAULCHMAN
KALCHIE@YAHOO.COM	2158166970


SULBASH MULTISERVICES CO. LTD
BASHIR DEHIRU
elbashoo4real@gmail.com


SULTAN WORLDWIDE
ABDUL UBAGARBA
sultanworldwidetrade@gmail.com


SYNADE NIG LTD
AHMAD ALIYU
SYNAdenigerialtd@gmail.com


SYS AUTOMOBILE NIG
ALMUSTAPHA MUHAMMAD SALISU
ALMUSTaphakabo@yahoo.com
$2,390.00


$2,390.00 overdue


Tacit Bridge Global Services
ALHASSEN KHALIFA
Tacitbridge@yahoo.com	2348095353787
$8,775.00


$8,775.00 overdue


Thomas Gyebi Bediako
mawulielliotlimited@yahoo.com	0243780740


TIMOTHY ABRAH


TUNS OPTIMAL MOTORS
ZAKARI ISHAKU
zakariishaku@gmail.com
$8,030.00


$8,030.00 overdue


UGO Erick
ericompub@gmail.com


UINGINE AUTOMOBILE SERVICES
DESMOND
DESmondgbeddy@gmail.com	+233 543926630


ULTIMATE LINKS COMPANY LIMITED
EDWARD KRAKU
eddiekraku@gmail.com


UMAR AMINU
uaauto.nig.ltd@gmail.com


UMAR HARUNA
HARUNAUMAR434@GMAIL.COM


UMAR MEMORIAL
BABANGIDA UMAR ADAMU
umarmemorialltd@gmail.com
$10,195.00


$4,165.00 overdue


UMR SHIPPING
UMAR@SHIPPING.COM
$12,145.00


$12,145.00 overdue


URIEL QUARTEY
URIOSCO@GMAIL.COM


Usu travel and tours
Bashir salisu
BASHIRSALISU79@GMAIL.COM	2349034444455


VEE AUTOWORLD
VINCENT KYEI
autoworldveegh@gmail.com	233241414057


VEHICLE DRY PORTS & TERMINALS
hamman ahmadu
hammanahmadu@gmail.com


VICTOR JOBARTEH
jobartehs@yahoo.com	603-866-1995


VICTOR KONADU BASOA
konadu.basoa@gmail.com
$7,500.00


$7,500.00 overdue


Vincent Fiberesima
vinross2000@yahoo.com	4842731373


VINSOLGLOBAL AUTO SALES LLC
Jogunola Olabanji
vinsolglobalautos@yahoo.com


Wellstream Trading
CHARLES SCHECK
wellstreamtrading@gmail.com
$2,325.00


$2,325.00 overdue


WHEELS LANE LTD
MICHAEL
info@wheelslane.com	0509391418


Wilhelm Okraku


WILLHELM HESSE
WILHESS18@YAHOO.COM


WILLIAM QUAYNOR
WILLIAM QUAYNOR
WILLIAmquaynor@gmail.com
$7,000.00


$7,000.00 overdue


WOLIPA TRANSPORT AND TRADING
FELIX
wolipatransportservices@gmail.com


Worldwide Shipping Consultants Inc
TOSHUA HOOKS
toshua@worldwideshippingconsultants.com	972-227-2424


Wouter van Bennekom
wbennekom@gmail.com	8607768677


WUDIL BAFFA
BAFFAALHAJI78@GMAIL.COM	+2347030165103


YAHYA SALI
saliyahaya13@gmail.com


YASMIN MOTORS NIG
ABDULRAHMANMUSA83@gmail.com


YAU GHANA
KUPTEE@YAHOO.COM
$1,350.00


$1,350.00 overdue


Yaw Agyekum-hene


YEHUDA HERSCHMAN
yehudaherschman@gmail.com	516-459-0174


YSY GLOBAL CONCEPT SERVICES
SULEANDERSON@YAHOO.COM	2348033613008


YURAMS INTERNATIONAL LIMITED
ibrahimza31@gmail.com


ZAI-LESS GLOBAL AUTOMOBILE
RABIU MAHMUD


ZAKARI HADII


ZAYYAD AUTOMOBILE
Abubakar Sadiq Umar
AUBAPPAH@GMAIL.COM	+2348036306460
$2,010.00


$2,010.00 overdue


ZEE-PLUS MULTI CONCEPTS LTD
KENNY
zaaplus11@gmail.com	09030006700


ZONEFIFA ORS NIG LTD
ALI MOHAMMED BUKAR`;

// ── Parser ────────────────────────────────────────────────────────────────────
function parseCustomers(raw) {
  const EMAIL_RX   = /^[^\s@]+@[^\s@]+\.[^\s@]+/i;
  const PHONE_RX   = /^[\d\s\+\-\(\)\.]{6,}$/;
  const BALANCE_RX = /^\$[\d,]+\.?\d*\s*$/;
  const OVERDUE_RX = /^\$([\d,]+\.?\d*)\s+overdue/i;

  function parseDollar(s) {
    return parseFloat((s || "").replace(/[$,]/g, "").trim()) || 0;
  }

  function isDataLine(l) {
    if (!l) return false;
    return EMAIL_RX.test(l) || PHONE_RX.test(l) || BALANCE_RX.test(l) || OVERDUE_RX.test(l);
  }

  // Parse line-by-line (state machine) so blank lines don't split balance from overdue
  const lines = raw.split("\n").map(l => l.trim());
  const customers = [];
  let cur = null;

  const flush = () => {
    if (cur && cur.companyName) customers.push(cur);
    cur = null;
  };

  const startNew = (name) => {
    flush();
    cur = { companyName: name, contactName: "", email: "", phone: "", balance: 0, overdue: 0 };
  };

  for (const rawLine of lines) {
    // Handle tab-separated content (email\tphone\t...)
    const parts = rawLine.split("\t").map(p => p.trim()).filter(Boolean);
    const l = parts[0] || "";

    if (!l) continue;  // blank line — keep current customer context

    // Dollar amounts — always attach to current customer
    const odm = l.match(OVERDUE_RX);
    if (odm) {
      if (cur) cur.overdue = parseDollar(odm[1]);
      continue;
    }
    if (BALANCE_RX.test(l)) {
      if (cur) cur.balance = parseDollar(l);
      continue;
    }

    // Email line
    if (EMAIL_RX.test(l)) {
      if (!cur) continue;
      if (!cur.email) cur.email = l;
      // check for phone in remaining tab parts
      for (let i = 1; i < parts.length; i++) {
        if (!cur.phone && PHONE_RX.test(parts[i])) cur.phone = parts[i];
      }
      continue;
    }

    // Pure phone (no @ sign, matches phone pattern)
    if (PHONE_RX.test(l) && !l.includes("@")) {
      if (cur && !cur.phone) cur.phone = l;
      // also check remaining tab parts for phone
      for (let i = 1; i < parts.length; i++) {
        if (cur && !cur.phone && PHONE_RX.test(parts[i])) cur.phone = parts[i];
      }
      continue;
    }

    // Otherwise: it's either a company name or contact name
    if (!cur) {
      // No current customer → start one
      startNew(l);
      // Check for email/phone on same tab-line
      for (let i = 1; i < parts.length; i++) {
        if (!cur.email && EMAIL_RX.test(parts[i])) cur.email = parts[i];
        else if (!cur.phone && PHONE_RX.test(parts[i])) cur.phone = parts[i];
      }
    } else if (!cur.email && !cur.phone && !cur.contactName) {
      // Could be contact name — but only if it doesn't look like an email
      cur.contactName = l;
    } else {
      // New company name — start a new customer
      startNew(l);
      for (let i = 1; i < parts.length; i++) {
        if (!cur.email && EMAIL_RX.test(parts[i])) cur.email = parts[i];
        else if (!cur.phone && PHONE_RX.test(parts[i])) cur.phone = parts[i];
      }
    }
  }

  flush();
  return customers;
}

// ── Import ────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/dock-receipt");
  console.log("MongoDB connected");

  const customers = parseCustomers(RAW);
  console.log(`Parsed ${customers.length} customers`);

  let inserted = 0, skipped = 0, updated = 0;

  for (const c of customers) {
    const existing = await AddressBook.findOne({
      companyName: { $regex: `^${c.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      type: "customer",
    });

    if (existing) {
      // Update fields that are empty / missing on the existing record
      const patch = {};
      if (!existing.contactName && c.contactName) patch.contactName = c.contactName;
      if (!existing.email       && c.email)       patch.email       = c.email;
      if (!existing.phone       && c.phone)       patch.phone       = c.phone;
      if (!existing.balance     && c.balance)     patch.balance     = c.balance;
      if (!existing.overdue     && c.overdue)     patch.overdue     = c.overdue;

      if (Object.keys(patch).length) {
        await AddressBook.findByIdAndUpdate(existing._id, { $set: patch });
        updated++;
        console.log(`  UPDATED  ${c.companyName}`);
      } else {
        skipped++;
        console.log(`  skipped  ${c.companyName}`);
      }
    } else {
      await AddressBook.create({ ...c, type: "customer" });
      inserted++;
      console.log(`  INSERTED ${c.companyName}`);
    }
  }

  console.log(`\nDone. Inserted: ${inserted} | Updated: ${updated} | Skipped (already up-to-date): ${skipped}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
