// "><(((º> sabusabu <º)))><"
"use strict";

// readPngInfo e buildStamp arrivano da stamp.js (caricato prima di questo file).
const CM_PER_INCH = 2.54;
// Formati pagina in cm: [lato lungo, lato corto].
const PAGE_FORMATS = new Map([
  ["A0", [118.9, 84.1]], ["A1", [84.1, 59.4]], ["A2", [59.4, 42]], ["A3", [42, 29.7]],
  ["A4", [29.7, 21]], ["A5", [21, 14.8]], ["A6", [14.8, 10.5]],
  ["Letter", [27.94, 21.59]], ["Legal", [35.56, 21.59]]
]);

const imageInput = document.querySelector("#image-input");
const dropzone = document.querySelector("#dropzone");
const fileListWrap = document.querySelector("#file-list-wrap");
const fileList = document.querySelector("#file-list");
const clearFilesButton = document.querySelector("#clear-files");
const generateButton = document.querySelector("#generate-button");
const outputNameInput = document.querySelector("#output-name");
const message = document.querySelector("#message");
const resultsPanel = document.querySelector("#results-panel");
const resultsSummary = document.querySelector("#results-summary");
const resultList = document.querySelector("#result-list");
const chooseFolderButton = document.querySelector("#choose-folder");
const destinationStatus = document.querySelector("#destination-status");
const removeBackgroundInput = document.querySelector("#remove-background");
const toleranceInput = document.querySelector("#bg-tolerance");
const toleranceValue = document.querySelector("#bg-tolerance-value");
const toleranceField = toleranceInput.closest(".field");
const pageFormatSelect = document.querySelector("#page-format");
const pageOrientationSelect = document.querySelector("#page-orientation");
const pageHeightInput = document.querySelector("#page-height");

let selectedFiles = [];
let destinationDirectory = null;
let cutoutRun = 0;
let cutoutTimer = null;

if (typeof window.showDirectoryPicker !== "function") {
  chooseFolderButton.title = "Il tuo browser non supporta la scelta di una cartella. Puoi scegliere la destinazione durante il salvataggio.";
  destinationStatus.textContent = typeof window.showSaveFilePicker === "function"
    ? "Scegli la destinazione al salvataggio"
    : "Cartella Download del browser";
} else {
  destinationStatus.textContent = "Nessuna cartella scelta";
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
  message.textContent = "";
  message.className = "message";
}

function clearResults() {
  resultList.replaceChildren();
  resultsPanel.hidden = true;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderFiles() {
  fileList.replaceChildren();
  fileListWrap.hidden = selectedFiles.length === 0;
  generateButton.disabled = selectedFiles.length === 0;
  outputNameInput.disabled = selectedFiles.length > 1;
  if (selectedFiles.length > 1) outputNameInput.value = "";

  selectedFiles.forEach(({ file, previewUrl, cutout }, index) => {
    const item = document.createElement("li");
    item.className = "file-row";

    const thumbnail = document.createElement("span");
    thumbnail.className = cutout ? "file-thumb is-cutout" : "file-thumb";
    const preview = document.createElement("img");
    preview.src = cutout ? cutout.url : previewUrl;
    preview.alt = "";
    thumbnail.append(preview);

    const meta = document.createElement("span");
    meta.className = "file-meta";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;
    const detail = document.createElement("span");
    detail.className = "file-detail";
    detail.textContent = formatBytes(file.size);
    meta.append(name, detail);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-file";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Rimuovi ${file.name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => removeFile(index));

    item.append(thumbnail, meta, removeButton);
    fileList.append(item);
  });
}

function releaseEntry(entry) {
  URL.revokeObjectURL(entry.previewUrl);
  if (entry.cutout) URL.revokeObjectURL(entry.cutout.url);
}

function removeFile(index) {
  releaseEntry(selectedFiles[index]);
  selectedFiles.splice(index, 1);
  clearResults();
  clearMessage();
  renderFiles();
}

function addFiles(files) {
  const incoming = Array.from(files);
  const invalidFiles = incoming.filter((file) => !file.name.toLowerCase().endsWith(".png") && file.type !== "image/png");
  if (invalidFiles.length > 0) {
    showMessage(`Formato non supportato: ${invalidFiles.map((file) => file.name).join(", ")}. Seleziona file PNG.`, "error");
  } else {
    clearMessage();
  }

  for (const file of incoming) {
    if (invalidFiles.includes(file) || selectedFiles.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
    selectedFiles.push({ file, previewUrl: URL.createObjectURL(file) });
  }

  clearResults();
  renderFiles();
  refreshCutouts();
  imageInput.value = "";
}

function readCutoutSettings() {
  return { enabled: removeBackgroundInput.checked, tolerance: Number(toleranceInput.value) / 100 };
}

function cutoutKey({ tolerance }) {
  return String(tolerance);
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Colore di sfondo = mediana dei pixel opachi sul bordo; null se il bordo e' gia' in gran parte trasparente.
function detectBackground(pixels, width, height) {
  const channels = [[], [], []];
  let borderPixels = 0;
  const sample = (x, y) => {
    const index = (y * width + x) * 4;
    borderPixels++;
    if (pixels[index + 3] < 250) return;
    for (let channel = 0; channel < 3; channel++) channels[channel].push(pixels[index + channel]);
  };
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    if (height > 1) sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    sample(0, y);
    if (width > 1) sample(width - 1, y);
  }
  if (channels[0].length < borderPixels / 2) return null;
  return channels.map(median);
}

// "Color to alpha": l'opacita' di ogni pixel e' quanto si discosta dallo sfondo, poi il colore viene
// ricostruito senza lo sfondo. Cosi' i bordi restano morbidi e spariscono anche i "buchi" interni (o, a, e).
function makeBackgroundTransparent(pixels, background, tolerance) {
  const lightBackground = background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114 >= 128;
  for (let index = 0; index < pixels.length; index += 4) {
    let alpha = 0;
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels[index + channel];
      const diff = lightBackground ? background[channel] - value : value - background[channel];
      const range = lightBackground ? background[channel] : 255 - background[channel];
      if (diff > 0 && range > 0) alpha = Math.max(alpha, diff / range);
    }
    if (alpha <= tolerance) {
      pixels[index + 3] = 0;
      continue;
    }
    for (let channel = 0; channel < 3; channel++) {
      const restored = background[channel] + (pixels[index + channel] - background[channel]) / alpha;
      pixels[index + channel] = Math.min(255, Math.max(0, Math.round(restored)));
    }
    pixels[index + 3] = Math.round(pixels[index + 3] * (alpha - tolerance) / (1 - tolerance));
  }
}

async function removeBackground(file, tolerance) {
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const background = detectBackground(imageData.data, canvas.width, canvas.height);
  if (!background) return file;
  makeBackgroundTransparent(imageData.data, background, tolerance);
  context.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("impossibile scontornare l'immagine")), "image/png");
  });
}

async function cutoutFor(entry, settings) {
  const key = cutoutKey(settings);
  if (entry.cutout?.key === key) return entry.cutout.blob;
  const blob = await removeBackground(entry.file, settings.tolerance);
  if (entry.cutout) URL.revokeObjectURL(entry.cutout.url);
  entry.cutout = { key, blob, url: URL.createObjectURL(blob) };
  return blob;
}

async function refreshCutouts() {
  const run = ++cutoutRun;
  const settings = readCutoutSettings();
  toleranceValue.textContent = `${toleranceInput.value}%`;
  toleranceInput.disabled = !settings.enabled;
  toleranceField.classList.toggle("is-disabled", !settings.enabled);

  if (!settings.enabled) {
    for (const entry of selectedFiles) {
      if (entry.cutout) URL.revokeObjectURL(entry.cutout.url);
      entry.cutout = null;
    }
    renderFiles();
    return;
  }

  for (const entry of selectedFiles.slice()) {
    try {
      await cutoutFor(entry, settings);
    } catch (error) {
      showMessage(`Impossibile scontornare ${entry.file.name}: ${error instanceof Error ? error.message : error}.`, "error");
    }
    if (run !== cutoutRun) return;
  }
  renderFiles();
}

function scheduleCutoutRefresh() {
  toleranceValue.textContent = `${toleranceInput.value}%`;
  clearTimeout(cutoutTimer);
  cutoutTimer = setTimeout(refreshCutouts, 150);
}

async function readImageData(entry) {
  const settings = readCutoutSettings();
  const source = settings.enabled ? await cutoutFor(entry, settings) : entry.file;
  return new Uint8Array(await source.arrayBuffer());
}

function readSettings() {
  const x = Number(document.querySelector("#position-x").value);
  const y = Number(document.querySelector("#position-y").value);
  const dpi = Number(document.querySelector("#dpi").value);
  const pageHeightCm = Number(pageHeightInput.value);
  if (![x, y, dpi, pageHeightCm].every(Number.isFinite)) {
    throw new Error("Inserisci valori numerici validi per tutte le impostazioni.");
  }
  if (dpi <= 0 || pageHeightCm <= 0) {
    throw new Error("La risoluzione e l'altezza della pagina devono essere maggiori di zero.");
  }
  return { x, y, dpi, pageHeight: pageHeightCm / CM_PER_INCH };
}

function applyPageFormat() {
  const size = PAGE_FORMATS.get(pageFormatSelect.value);
  if (!size) return;
  pageHeightInput.value = String(pageOrientationSelect.value === "landscape" ? size[1] : size[0]);
}

// Altezza scritta a mano: se coincide con un formato lo seleziona (prima i verticali,
// perche' 29,7 cm e' sia A4 verticale sia A3 orizzontale), altrimenti "Personalizzato".
function syncPageFormat() {
  const height = Number(pageHeightInput.value);
  for (const [orientation, side] of [["portrait", 0], ["landscape", 1]]) {
    for (const [name, size] of PAGE_FORMATS) {
      if (Math.abs(height - size[side]) < 0.005) {
        pageFormatSelect.value = name;
        pageOrientationSelect.value = orientation;
        return;
      }
    }
  }
  pageFormatSelect.value = "custom";
}

function outputFilename(file, total) {
  if (total === 1 && outputNameInput.value.trim()) return normalizeStampFilename(outputNameInput.value);
  return normalizeStampFilename(file.name.replace(/\.png$/i, ""));
}

function normalizeStampFilename(value) {
  const stem = value.trim().replace(/(?:\.stamp)+$/i, "").trim();
  if (!stem) throw new Error("Inserisci un nome valido per il file .stamp.");
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(stem) || /[. ]$/.test(stem)) {
    throw new Error("Il nome del file contiene caratteri non validi o termina con un punto o uno spazio.");
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) {
    throw new Error("Questo nome è riservato dal sistema. Scegline un altro.");
  }
  return `${stem}.stamp`;
}

function renderResults(results) {
  resultList.replaceChildren();
  clearResults();
  resultsSummary.textContent = `${results.length} ${results.length === 1 ? "file generato" : "file generati"} con successo.`;

  results.forEach(({ name, blob }) => {
    const row = document.createElement("li");
    row.className = "result-row";
    const icon = document.createElement("span");
    icon.className = "result-file-icon";
    icon.textContent = ".STAMP";
    const meta = document.createElement("span");
    meta.className = "result-meta";
    const fileName = document.createElement("input");
    fileName.className = "result-name-input";
    fileName.type = "text";
    fileName.value = name.replace(/\.stamp$/i, "");
    fileName.setAttribute("aria-label", "Nome del file .stamp");
    fileName.autocomplete = "off";
    const size = document.createElement("span");
    size.className = "result-size";
    size.textContent = formatBytes(blob.size);
    meta.append(fileName, size);
    const saveButton = document.createElement("button");
    saveButton.className = "download-link";
    saveButton.type = "button";
    saveButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Salva file';
    saveButton.addEventListener("click", async () => {
      try {
        const filename = normalizeStampFilename(fileName.value);
        await saveStamp(blob, filename);
        showMessage(`File salvato come "${filename}".`, "success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        showMessage(error instanceof Error ? error.message : "Impossibile salvare il file.", "error");
      }
    });
    row.append(icon, meta, saveButton);
    resultList.append(row);
  });

  resultsPanel.hidden = false;
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveStamp(blob, filename) {
  if (destinationDirectory) {
    const fileHandle = await destinationDirectory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
    return;
  }

  if (typeof window.showSaveFilePicker === "function") {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "File timbro OpenText", accept: { "application/xml": [".stamp"] } }]
    });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

chooseFolderButton.addEventListener("click", async () => {
  if (typeof window.showDirectoryPicker !== "function") {
    showMessage("La scelta di una cartella non è supportata da questo browser. Usa un browser compatibile o scegli la destinazione al momento del salvataggio.", "error");
    return;
  }
  try {
    destinationDirectory = await window.showDirectoryPicker({ mode: "readwrite" });
    destinationStatus.textContent = `Cartella scelta: ${destinationDirectory.name}`;
    showMessage(`I file verranno salvati nella cartella "${destinationDirectory.name}".`, "success");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    showMessage(error instanceof Error ? error.message : "Impossibile accedere alla cartella selezionata.", "error");
  }
});

imageInput.addEventListener("change", (event) => addFiles(event.target.files));
clearFilesButton.addEventListener("click", () => {
  for (const entry of selectedFiles) releaseEntry(entry);
  selectedFiles = [];
  clearResults();
  clearMessage();
  renderFiles();
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}
dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
removeBackgroundInput.addEventListener("change", () => {
  clearResults();
  refreshCutouts();
});
toleranceInput.addEventListener("input", () => {
  clearResults();
  scheduleCutoutRefresh();
});
pageFormatSelect.addEventListener("change", applyPageFormat);
pageOrientationSelect.addEventListener("change", applyPageFormat);
pageHeightInput.addEventListener("input", syncPageFormat);

generateButton.addEventListener("click", async () => {
  clearMessage();
  clearResults();
  generateButton.disabled = true;
  try {
    const settings = readSettings();
    const results = [];
    for (const entry of selectedFiles) {
      const { file } = entry;
      const data = await readImageData(entry);
      const xml = buildStamp(data, file.name, settings);
      results.push({
        name: outputFilename(file, selectedFiles.length),
        blob: new Blob([xml], { type: "application/xml;charset=utf-8" })
      });
    }
    renderResults(results);
    showMessage("Operazione completata. Scarica i file generati qui sotto.", "success");
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Impossibile generare i file .stamp.", "error");
  } finally {
    generateButton.disabled = selectedFiles.length === 0;
  }
});
