/**
 * Keep each car's status in step with its container:
 *   in a container                      → at least "Delivered" (it's at the loader)
 *   container has a booking #           → at least "Waiting to Sail"
 *   container sailed                    → at least "Sailed"
 *   (sailed = marked Sailed/Arrived/Released, or its cutoff date has passed)
 * Statuses only move forward; Canceled / Problem-Hold orders are left alone.
 * Each change gets a timeline entry and the order's Drive folder is moved, the
 * same as a manual status change.
 */
const Order = require("../models/Order");
const ContainerLoad = require("../models/ContainerLoad");

const FLOW = ["New Order", "Awaiting Pickup", "Picked Up", "Delivered", "Waiting to Sail", "Sailed", "Arrived", "Paid", "Completed"];
const rank = (s) => FLOW.indexOf(s || "New Order");

const todayISO = () => new Date().toISOString().slice(0, 10);

async function syncLoadOrders(loadOrId) {
  const load = loadOrId?.orderIds ? loadOrId : await ContainerLoad.findById(loadOrId).lean();
  if (!load || !(load.orderIds || []).length) return 0;
  const orders = await Order.find({ _id: { $in: load.orderIds } });

  // Sailed = marked so, or its cutoff date has passed (the containers list treats that as sailing)
  const sailed = ["Sailed", "Arrived", "Released"].includes(load.status)
    || (load.sailCutoff && load.sailCutoff <= todayISO());
  const target = sailed ? "Sailed" : load.bookingNumber ? "Waiting to Sail" : "Delivered";
  const why = sailed ? "container sailed" : load.bookingNumber ? `container booked (${load.bookingNumber})` : "added to a container";

  const { moveDriveFolder } = require("../googleDrive");
  const { folderForStatus } = require("../routes/orders");
  let changed = 0;
  for (const o of orders) {
    const r = rank(o.status);
    if (r < 0 || r >= rank(target)) continue;   // Canceled, Problem/Hold, or already further along
    const prev = o.status || "New Order";
    o.status = target;
    o.timeline.push({ action: "Status Changed", details: `Auto-updated from "${prev}" to "${target}" — ${why}, load ${load.name}.`, createdAt: new Date() });
    await o.save();
    if (o.driveFolderId && folderForStatus) {
      moveDriveFolder(o.driveFolderId, folderForStatus(target)).catch(e => console.warn("[loadStatus] Drive move failed:", e.message));
    }
    changed++;
  }
  return changed;
}

// Every open container — run on a timer so sail dates are picked up as they pass
async function syncAllLoads() {
  const loads = await ContainerLoad.find({ status: { $ne: "Released" }, "orderIds.0": { $exists: true } }).lean();
  let changed = 0;
  for (const l of loads) changed += await syncLoadOrders(l).catch(e => { console.warn("[loadStatus]", l.name, e.message); return 0; });
  return changed;
}

module.exports = { syncLoadOrders, syncAllLoads, FLOW };
