import "./style.css";
import { demo, minor, used, reserveDemo } from "./model.js";
import { LedgerSession, readJSON } from "./session.js";
import { createAdapter } from "./network.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let mode = "demo",
  state = demo(),
  busy = false;
const adapter = createAdapter();
const savedConfig = readJSON(localStorage, "grantweave-config", {});
const config =
  savedConfig && typeof savedConfig === "object" && !Array.isArray(savedConfig)
    ? savedConfig
    : {};
const session = new LedgerSession({ adapter, storage: localStorage, notify });
const emptyState = () => ({
  schema: 1,
  project: "Read a project contract",
  currency: "USD",
  owner: "",
  costs: [],
  reservations: [],
});
const cash = (n) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: state.currency,
  }).format(n / 100);
$("#app").innerHTML =
  `<header><a class="brand" href="#"><img class="mark" src="./grantweave-logo.svg" alt="" width="42" height="42"> GrantWeave</a><nav><a href="#ledger">Cost ledger</a><a href="#how">How it works</a><button id="mode" class="quiet">Switch to live</button><button id="wallet">Connect wallet</button></nav></header><main><div class="eyebrow">SHARED FUNDING. CLEAR BOUNDARIES.</div><section class="hero"><div><h1>Many funders.<br><em>One honest ledger.</em></h1><p>Keep every project expense visible. Catch renamed duplicate costs before funding overlaps, and share the remaining capacity with confidence.</p><a class="cta" href="#ledger">Open the cost ledger ↗</a></div><aside class="hero-card"><span class="tag">THE FUNDING THREAD</span><div class="thread"><span>Science fund</span><b>↘</b><strong>One microscope</strong><b>↗</b><span>Local sponsor</span></div><div class="rule">Two contributions. One expense cap.</div><p>GenLayer checks meaning.<br>The contract protects the numbers.</p></aside></section><div id="notice" role="status" aria-live="polite"></div><section id="settings" hidden><h2>Live connection</h2><p>Studionet · chain ${adapter.chainId}. Reading is public. Writing requires the project registrar’s wallet signature.</p><label>Deployed GrantOverlap address<input id="address" placeholder="0x…" value="${esc(config.address || "")}"></label><button id="load">Read contract</button><button id="recover" class="quiet">Resume pending transaction</button><label>Existing transaction ID (optional)<input id="txhash" placeholder="0x…" autocomplete="off"></label><button id="track" class="quiet">Track transaction</button><a href="./contracts/grant_overlap.py" download>Download contract source ↗</a></section><section id="ledger"><div class="section-head"><div><div class="eyebrow">PROJECT WORKSPACE</div><h2 id="project"></h2></div><div><span id="badge" class="tag"></span><button class="quiet" id="export">Export ledger ↓</button></div></div><div class="stats" id="stats"></div><div class="workspace"><div><div id="costs"></div><h3>Funding history</h3><div id="history"></div></div><aside class="panel"><h3>Reserve a contribution</h3><p>Split funding across sources without exceeding the underlying expense.</p><form id="reserve"><label>Expense<select name="cost" id="cost-select"></select></label><label>Funding source<input name="source" required maxlength="160" placeholder="e.g. Community science fund"></label><div class="pair"><label>Amount<input name="amount" required inputmode="decimal" placeholder="250.00"></label><label>Unique reference<input name="reference" required maxlength="160" placeholder="FUND-002"></label></div><button>Reserve capacity ↗</button></form><hr><h3>Register an expense</h3><p>Existing costs are compared by meaning before a new cap can be created.</p><form id="register"><label>Expense description<input name="description" required maxlength="900" placeholder="What is being purchased?"></label><label>Invoice / supporting facts<textarea name="evidence" required maxlength="1800" placeholder="Supplier, invoice identifier, service period and deliverable"></textarea></label><label>Total expense cap<input name="cap" required inputmode="decimal" placeholder="1200.00"></label><button class="secondary">Check & register</button></form></aside></div></section><section id="how"><div class="eyebrow">MEANING → CONSENSUS → CAPACITY</div><h2>Different wording should not create extra money.</h2><div class="steps"><article><b>01 / Compare the expense</b><p>Independent validator reasoning checks whether a new cost is distinct, duplicated or uncertain.</p></article><article><b>02 / Enforce the cap</b><p>Contributions reserve integer minor units against one immutable cost ceiling.</p></article><article><b>03 / Keep the history</b><p>Release unused reservations without erasing their original source or reference.</p></article></div></section><footer>GrantWeave · A shared register, not a payment processor.<br>Checks cover this project's recorded costs and supplied evidence. They do not certify invoices or discover undisclosed external funding.</footer></main>`;
function notify(message, error = false) {
  $("#notice").textContent = message;
  $("#notice").className = error ? "error" : "";
}
function render() {
  $("#project").textContent = state.project;
  $("#badge").textContent =
    mode === "demo" ? "ILLUSTRATIVE DEMO" : "LIVE · STUDIONET";
  const total = state.costs.reduce((n, c) => n + c.cap, 0),
    occupied = state.costs.reduce((n, c) => n + used(state, c.id), 0);
  $("#stats").innerHTML =
    `<div><span>REGISTERED COSTS</span><strong>${state.costs.length}</strong></div><div><span>RESERVED CAPACITY</span><strong>${cash(occupied)}</strong></div><div><span>AVAILABLE CAPACITY</span><strong>${cash(total - occupied)}</strong></div>`;
  $("#costs").innerHTML =
    state.costs
      .map(
        (c) =>
          `<article class="cost"><div class="cost-head"><span class="tag">EXPENSE ${String(c.id).padStart(2, "0")}</span><span>${cash(c.cap)} cap</span></div><h3>${esc(c.description)}</h3><p>${esc(c.evidence)}</p><progress max="${c.cap}" value="${used(state, c.id)}"></progress><div class="cost-head"><span>${cash(used(state, c.id))} reserved</span><strong>${cash(c.cap - used(state, c.id))} left</strong></div></article>`,
      )
      .join("") || "<p>No registered expenses yet.</p>";
  const selected = $("#cost-select").value;
  $("#cost-select").innerHTML = state.costs
    .map((c) => `<option value="${c.id}">${esc(c.description)}</option>`)
    .join("");
  $("#history").innerHTML =
    state.reservations
      .map(
        (r) =>
          `<div class="entry"><div><b>${esc(r.source)}</b><small>Expense ${r.cost_id} · ${esc(r.reference)} · ${r.active ? "Reserved" : "Released"}</small></div><strong>${cash(r.amount)}</strong>${r.active ? `<button class="quiet release" data-id="${r.id}">Release</button>` : ""}</div>`,
      )
      .join("") || "<p>No contributions recorded.</p>";
  if ([...$("#cost-select").options].some((o) => o.value === selected))
    $("#cost-select").value = selected;
  document
    .querySelectorAll("button,input,textarea,select")
    .forEach((b) => (b.disabled = busy));
  if (mode === "live" && (!session.state || session.stale))
    document
      .querySelectorAll("#reserve button,#register button,.release")
      .forEach((b) => (b.disabled = true));
  $("#export").disabled = busy || (mode === "live" && !session.state);
  $("#register button").disabled =
    busy || mode === "demo" || !session.state || session.stale;
  document
    .querySelectorAll(".release")
    .forEach(
      (b) =>
        (b.onclick = () =>
          action(() =>
            mode === "demo"
              ? ((state.reservations.find(
                  (r) => r.id === Number(b.dataset.id),
                ).active = false),
                demoNotice())
              : write("release", [Number(b.dataset.id)]),
          )),
    );
}
async function action(fn) {
  if (busy) return;
  busy = true;
  render();
  try {
    await fn();
  } catch (e) {
    notify(
      e.code === 4001
        ? "Wallet request declined. No new transaction was submitted."
        : e.message || String(e),
      true,
    );
  } finally {
    if (mode === "live") state = session.state || emptyState();
    busy = false;
    render();
  }
}
function demoNotice() {
  notify("Illustrative demo updated. No blockchain transaction was sent.");
}
const write = (name, args) => session.write(name, args);
$("#wallet").onclick = () =>
  action(async () => {
    const account = await session.connect();
    $("#wallet").textContent = account.slice(0, 6) + "…" + account.slice(-4);
    notify("Wallet connected. Live writes require the project registrar.");
  });
$("#mode").onclick = () =>
  action(async () => {
    session.unload();
    mode = mode === "demo" ? "live" : "demo";
    $("#settings").hidden = mode === "demo";
    $("#mode").textContent =
      mode === "demo" ? "Switch to live" : "Switch to demo";
    state = mode === "demo" ? demo() : emptyState();
    notify(
      mode === "demo"
        ? "Illustrative demo. No blockchain transactions."
        : "Read a deployed GrantOverlap contract. A wallet is only needed to write.",
    );
  });
$("#load").onclick = () =>
  action(async () => {
    state = emptyState();
    await session.load($("#address").value.trim());
    config.address = session.address;
    try {
      localStorage.setItem("grantweave-config", JSON.stringify(config));
    } catch {
      /* Read-only use remains available if browser storage is disabled. */
    }
    notify("Live contract loaded. Registrar: " + session.state.owner);
  });
$("#recover").onclick = () => action(() => session.resume());
$("#track").onclick = () =>
  action(() => session.resume($("#txhash").value.trim()));
$("#reserve").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  action(async () => {
    const args = [
      Number(f.get("cost")),
      f.get("source").trim(),
      minor(f.get("amount")),
      f.get("reference").trim(),
    ];
    if (mode === "demo") {
      reserveDemo(state, ...args);
      demoNotice();
    } else await write("reserve", args);
  });
};
$("#register").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  action(async () => {
    const args = [
      f.get("description").trim(),
      f.get("evidence").trim(),
      minor(f.get("cap")),
    ];
    if (mode === "demo")
      throw Error(
        "Semantic comparison requires live GenLayer consensus. Connect a deployed contract to register costs.",
      );
    await write("register_cost", args);
  });
};
$("#export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          mode,
          chainId: mode === "live" ? adapter.chainId : null,
          contract: mode === "live" ? session.address : null,
          stateFresh: mode === "demo" || !session.stale,
          exportedAt: new Date().toISOString(),
          ledger: state,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `grantweave-${mode}-ledger.json`;
  a.click();
  URL.revokeObjectURL(url);
};
window.ethereum?.on?.("accountsChanged", () => {
  session.walletChanged();
  $("#wallet").textContent = "Reconnect wallet";
  notify(
    "Wallet changed. Public ledger remains available; reconnect before writing.",
  );
});
window.ethereum?.on?.("chainChanged", () => {
  session.walletChanged();
  $("#wallet").textContent = "Reconnect wallet";
  notify("Network changed. Reconnect to Studionet before writing.");
});
render();
notify(
  "Illustrative demo · explore reservations and releases. Semantic checks require live GenLayer.",
);
