(function () {
  "use strict";
// "><(((º> sabusabu <º)))><"

  // Ping ogni 10 secondi per tenere vivo il watchdog server
  setInterval(function () {
    fetch("/ping", { method: "POST" }).catch(function () {});
  }, 10000);
})();
