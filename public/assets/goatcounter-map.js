(function () {
  "use strict";

  const currentScript = document.currentScript;
  const scriptURL = currentScript && currentScript.src
    ? currentScript.src
    : new URL("assets/goatcounter-map.js", window.location.href).href;
  const dataURL = new URL("../data/goatcounter-map.json", scriptURL).href;

  const STYLE = `
    #gc-map-button {
      position: fixed; right: 22px; bottom: 22px; z-index: 99998;
      display: inline-flex; align-items: center; gap: 8px;
      border: 0; border-radius: 999px; padding: 12px 17px;
      color: #fff; background: #243b60; cursor: pointer;
      box-shadow: 0 5px 20px rgba(0,0,0,.22);
      font: 600 14px/1.2 system-ui, sans-serif;
      transition: transform .18s ease, background .18s ease;
    }
    #gc-map-button:hover { background: #355783; transform: translateY(-2px); }
    #gc-map-button:focus-visible, #gc-map-close:focus-visible {
      outline: 3px solid #76a9e8; outline-offset: 3px;
    }
    #gc-map-overlay {
      display: none; position: fixed; inset: 0; z-index: 99999;
      align-items: center; justify-content: center; padding: 16px;
      background: rgba(12, 23, 39, .62);
    }
    #gc-map-overlay.gc-open { display: flex; }
    #gc-map-dialog {
      width: min(1000px, 96vw); height: min(690px, 90vh);
      display: flex; flex-direction: column; overflow: hidden;
      border-radius: 18px; background: #fff; color: #26364b;
      box-shadow: 0 20px 70px rgba(0,0,0,.3);
      font-family: system-ui, sans-serif;
    }
    #gc-map-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 17px 21px; border-bottom: 1px solid #e8edf3;
    }
    #gc-map-head h2 { margin: 0; font-size: 18px; font-weight: 700; }
    #gc-map-close {
      flex: 0 0 auto; width: 36px; height: 36px; border: 0;
      border-radius: 50%; background: #eef2f7; color: #26364b;
      cursor: pointer; font-size: 23px; line-height: 1;
    }
    #gc-map-summary {
      padding: 12px 21px; color: #52647b; font-size: 13px;
    }
    #gc-map-chart { flex: 1; min-height: 240px; width: 100%; }
    #gc-map-foot {
      padding: 10px 21px; border-top: 1px solid #e8edf3;
      color: #7b8797; font-size: 11px;
    }
    @media (max-width: 600px) {
      #gc-map-button { right: 14px; bottom: 14px; }
      #gc-map-dialog { height: 84vh; }
      #gc-map-head { padding: 14px 15px; }
      #gc-map-summary { padding: 10px 15px; }
      #gc-map-foot { padding: 9px 15px; }
    }
  `;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.id = "gc-map-button";
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "gc-map-overlay");
  button.innerHTML = '<span aria-hidden="true">🌍</span><span id="gc-map-total">Loading…</span>';

  const overlay = document.createElement("div");
  overlay.id = "gc-map-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section id="gc-map-dialog" role="dialog" aria-modal="true"
             aria-labelledby="gc-map-title">
      <header id="gc-map-head">
        <h2 id="gc-map-title">Visitors around the world</h2>
        <button id="gc-map-close" type="button" aria-label="Close map">×</button>
      </header>
      <div id="gc-map-summary">Loading GoatCounter statistics…</div>
      <div id="gc-map-chart" aria-label="World map of visitor countries"></div>
      <footer id="gc-map-foot">
        Country-level statistics from GoatCounter. Counts are pageviews; location is approximate.
      </footer>
    </section>
  `;

  document.body.appendChild(button);
  document.body.appendChild(overlay);

  const totalLabel = button.querySelector("#gc-map-total");
  const summary = overlay.querySelector("#gc-map-summary");
  const chartNode = overlay.querySelector("#gc-map-chart");
  const closeButton = overlay.querySelector("#gc-map-close");

  let mapData = null;
  let chart = null;
  let googleReady = false;
  let loadPromise = null;

  const number = value => Number(value || 0).toLocaleString();

  function showOverlay() {
    overlay.classList.add("gc-open");
    overlay.setAttribute("aria-hidden", "false");
    closeButton.focus();
    loadData().then(() => {
      if (googleReady) drawMap();
    }).catch(error => {
      summary.textContent = "Could not load visitor statistics. Please try again later.";
      console.error("[GoatCounter map]", error);
    });
  }

  function hideOverlay() {
    overlay.classList.remove("gc-open");
    overlay.setAttribute("aria-hidden", "true");
    button.focus();
  }

  async function loadData() {
    if (mapData) return mapData;
    if (loadPromise) return loadPromise;

    loadPromise = fetch(dataURL + "?v=" + Date.now(), { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Statistics JSON returned HTTP " + response.status);
        return response.json();
      })
      .then(data => {
        if (!data || !Array.isArray(data.locations)) {
          throw new Error("Statistics JSON has an unexpected format.");
        }
        mapData = data;
        totalLabel.textContent = number(data.total_pageviews) + " views";
        summary.textContent =
          number(data.total_pageviews) + " total pageviews · Updated " +
          new Date(data.generated_at).toLocaleString();
        return mapData;
      })
      .catch(error => {
        loadPromise = null;
        totalLabel.textContent = "Stats unavailable";
        throw error;
      });

    return loadPromise;
  }

  function drawMap() {
    if (!mapData || !googleReady) return;

    const rows = [["Country", "Pageviews"]];
    mapData.locations.forEach(item => {
      if (item.code && Number(item.count) > 0) {
        rows.push([item.code, Number(item.count)]);
      }
    });

    if (rows.length === 1) {
      chartNode.textContent = "No country-level location data is available yet.";
      return;
    }

    const data = google.visualization.arrayToDataTable(rows);
    const options = {
      region: "world",
      displayMode: "regions",
      resolution: "countries",
      colorAxis: { colors: ["#e8f0fa", "#a8c5e5", "#5688bd", "#234d7b"] },
      backgroundColor: "#ffffff",
      datalessRegionColor: "#f0f2f5",
      defaultColor: "#f0f2f5",
      legend: { textStyle: { color: "#52647b", fontSize: 12 } },
      tooltip: { textStyle: { color: "#26364b" } },
      keepAspectRatio: true
    };

    if (!chart) chart = new google.visualization.GeoChart(chartNode);
    chart.draw(data, options);
  }

  function loadGoogleCharts() {
    if (window.google && google.visualization) {
      googleReady = true;
      if (overlay.classList.contains("gc-open")) drawMap();
      return;
    }

    const existing = document.querySelector('script[data-gc-google-charts]');
    if (existing) {
      existing.addEventListener("load", configureGoogleCharts, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.gcGoogleCharts = "true";
    script.src = "https://www.gstatic.com/charts/loader.js";
    script.async = true;
    script.onload = configureGoogleCharts;
    script.onerror = () => {
      summary.textContent = "The map library could not be loaded. Check your connection.";
    };
    document.head.appendChild(script);
  }

  function configureGoogleCharts() {
    google.charts.load("current", { packages: ["geochart"] });
    google.charts.setOnLoadCallback(() => {
      googleReady = true;
      if (overlay.classList.contains("gc-open")) drawMap();
    });
  }

  button.addEventListener("click", showOverlay);
  closeButton.addEventListener("click", hideOverlay);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) hideOverlay();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && overlay.classList.contains("gc-open")) hideOverlay();
  });
  window.addEventListener("resize", () => {
    if (overlay.classList.contains("gc-open") && chart && googleReady) drawMap();
  });

  loadData().catch(() => {});
  loadGoogleCharts();
})();
