// app.js

// Variables globales
let workbook, worksheet, matchingRows = [], currentIndex = 0;
let keyAgente = "", keyDoc = "", keyIncidencia = "", keyTextoIncidencia = "", keyEntrega = "";
let fileName = "", db = null, archivoPendiente = null, modalArchivo = null;

// 1. Inicializar IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("tipificacion_db", 1);
    req.onerror = () => reject("Error al abrir IndexedDB");
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains("gestiones")) {
        db.createObjectStore("gestiones", { keyPath: "fileName" });
      }
    };
  });
}

// 2. Guardar sesión en IndexedDB
function saveSession() {
  if (!db || !fileName) return;
  const tx = db.transaction("gestiones", "readwrite");
  tx.objectStore("gestiones").put({ fileName, currentIndex, matchingRows });
}

// 3. Cargar sesión desde IndexedDB
function loadSession(name) {
  return new Promise(resolve => {
    if (!db) return resolve(null);
    const tx = db.transaction("gestiones", "readonly");
    tx.objectStore("gestiones").get(name).onsuccess = e => resolve(e.target.result);
  });
}

// 4. Limpiar sesiones previas (otros archivos)
function clearPreviousSessions(current) {
  if (!db) return;
  const tx = db.transaction("gestiones", "readwrite");
  tx.objectStore("gestiones").getAllKeys().onsuccess = e => {
    e.target.result.forEach(k => {
      if (k !== current) tx.objectStore("gestiones").delete(k);
    });
  };
}

// 5. Setup al cargar el DOM
document.addEventListener("DOMContentLoaded", async () => {
  await initDB();

  // Mostrar agente
  const agentName = localStorage.getItem("agentName") || "";
  document.getElementById("agentDisplay").textContent = agentName;

  // Listeners UI
  const fileInput = document.getElementById("fileInput");
  if (fileInput) fileInput.addEventListener("change", handleFile);

  const btnModo = document.getElementById("modoOscuroBtn");
  if (btnModo) btnModo.addEventListener("click", toggleDarkMode);

  const btnDesc = document.getElementById("btnDescargar");
  if (btnDesc) btnDesc.addEventListener("click", descargarArchivo);

  const btnNext = document.getElementById("btnSiguiente");
  if (btnNext) btnNext.addEventListener("click", siguienteFila);

  const btnPrev = document.getElementById("btnAnterior");
  if (btnPrev) btnPrev.addEventListener("click", filaAnterior);

  const btnConfirm = document.getElementById("confirmarCambio");
  if (btnConfirm) {
    modalArchivo = new bootstrap.Modal(document.getElementById("modalArchivo"));
    btnConfirm.addEventListener("click", () => {
      modalArchivo.hide();
      if (archivoPendiente) cargarArchivo(archivoPendiente);
      archivoPendiente = null;
    });
  }
});

// 6. Manejar selección de archivo
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (fileName && matchingRows.length > 0 && file.name !== fileName) {
    archivoPendiente = file;
    modalArchivo.show();
  } else {
    cargarArchivo(file);
  }
}

// 7. Cargar y procesar Excel
function cargarArchivo(file) {
  fileName = file.name;
  clearPreviousSessions(fileName);

  // Overlay
  const overlay = document.getElementById("overlay");
  const textoOv = document.getElementById("overlay-text");
  if (overlay && textoOv) {
    textoOv.textContent = "Procesando archivo…";
    overlay.style.display = "flex";
  }

  const reader = new FileReader();
  reader.onload = async evt => {
    try {
      const data = new Uint8Array(evt.target.result);
      workbook = XLSX.read(data, { type: "array" });
      worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

      // Detectar columnas
      const cols = Object.keys(json[0] || {});
      keyAgente          = cols.find(c => /agente/i.test(c))          || "";
      keyIncidencia      = cols.find(c => /inci/i.test(c))            || "Nº Incidencia";
      keyDoc             = cols.find(c => /doc/i.test(c))             || "Doc. Comercial";
      keyEntrega         = cols.find(c => /entrega/i.test(c))         || "Entrega";
      keyTextoIncidencia = cols.find(c => /texto/i.test(c))           || "Texto Incidencia";
      // Filtrar por agente
      const agentName = localStorage.getItem("agentName") || "";
      const filas = agentName.toLowerCase() === "todo"
        ? json
        : json.filter(r =>
            r[keyAgente]?.toString().trim().toLowerCase() === agentName.toLowerCase()
          );

      if (filas.length === 0) {
        document.getElementById("infoFila").innerHTML = `
          <p class="text-danger fw-bold">
            🚫 Este archivo no contiene casos para el agente.
          </p>
          <button class="btn btn-warning" onclick="volverAInicio()">
            Volver
          </button>`;
        document.getElementById("restantes").textContent = "0";
        return;
      }

      // Restaurar sesión guardada
      const saved = await loadSession(fileName);
      matchingRows = saved?.matchingRows || filas;
      currentIndex = saved?.currentIndex || 0;

      mostrarFila();
      actualizarContador();
      reconstruirListaGestionados();
    } finally {
      if (overlay) overlay.style.display = "none";
    }
  };
  reader.readAsArrayBuffer(file);

  // Título archivo
  document.getElementById("tituloArchivo").textContent = `Archivo: ${fileName}`;
}

// 8. Mostrar fila actual
function mostrarFila() {
  const info = document.getElementById("infoFila");
  const row = matchingRows[currentIndex];
  if (!row) {
    info.innerHTML = "<p>¡No hay más filas para mostrar!</p>";
    return;
  }
  info.innerHTML = `
    <p><strong>${keyIncidencia}:</strong> ${row[keyIncidencia] || "-"}</p>
    <p><strong>${keyDoc}:</strong> ${row[keyDoc] || "-"}</p>
    <p><strong>${keyEntrega}:</strong> ${row[keyEntrega] || "-"}</p>    
    <p><strong>${keyTextoIncidencia}:</strong> ${row[keyTextoIncidencia] || "-"}</p>
  `;
  document.getElementById("tipificacion").value = row["TIPIFICACIÓN"] || "";
}

// 9. Guardar tipificación
function guardarTipificacion() {
  if (currentIndex >= matchingRows.length) return;
  const val = document.getElementById("tipificacion").value.trim();
  const row = matchingRows[currentIndex];

  if (val === "" || val === "(Sin seleccion)") {
    delete row["TIPIFICACIÓN"];
    row["OBSERVACIÓN"] = "NO PERMITE GESTION";
  } else {
    row["TIPIFICACIÓN"] = val;
    delete row["OBSERVACIÓN"];
  }

  const msg = document.getElementById("mensajeGuardado");
  msg.textContent = "✅ Tipificación guardada";
  msg.style.display = "block";
  setTimeout(() => msg.style.display = "none", 2500);

  saveSession();
}

// 10. Navegación de filas
function siguienteFila() {
  if (currentIndex < matchingRows.length) {
    guardarTipificacion();
    agregarAGestionados(matchingRows[currentIndex]);
    currentIndex++;
    mostrarFila();
    actualizarContador();
  }
}

function filaAnterior() {
  if (currentIndex > 0) {
    guardarTipificacion();
    currentIndex--;
    quitarUltimoGestionado();
    mostrarFila();
    actualizarContador();
  } else {
    const msg = document.getElementById("mensajeGuardado");
    msg.textContent = "⚠️ Ya estás en la primera fila";
    msg.style.display = "block";
    setTimeout(() => msg.style.display = "none", 2500);
  }
}

// 11. Contador restantes
function actualizarContador() {
  const rem = matchingRows.length - currentIndex;
  document.getElementById("restantes").textContent = rem;
}

// 12. Volver a inicio
function volverAInicio() {
  localStorage.removeItem("agentName");
  window.location.href = "index.html";
}

// 13. Lista de casos gestionados (horizontal)
function agregarAGestionados(fila) {
  const ul = document.getElementById("listaGestionados");
  if (!ul) return;

  const li = document.createElement("li");
  li.className = "list-group-item d-flex justify-content-between align-items-center";

  const contenido = `
    <div>
      <strong>Incidencia:</strong> ${fila[keyIncidencia] || "N/A"} |
      <strong>Doc:</strong> ${fila[keyDoc] || "N/A"} |
      <strong>Entrega:</strong> ${fila[keyEntrega] || "N/A"}
    </div>
    <span class="badge bg-primary">
      ${fila["TIPIFICACIÓN"] || fila["OBSERVACIÓN"] || "-"}
    </span>
  `;
  li.innerHTML = contenido;
  ul.appendChild(li);
}

function quitarUltimoGestionado() {
  const ul = document.getElementById("listaGestionados");
  if (ul.lastChild) ul.removeChild(ul.lastChild);
}

function reconstruirListaGestionados() {
  const ul = document.getElementById("listaGestionados");
  ul.innerHTML = "";
  for (let i = 0; i < currentIndex; i++) {
    agregarAGestionados(matchingRows[i]);
  }
}

// 14. Modo oscuro
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  const icon = document.getElementById("iconoTema");
  if (icon) icon.classList.toggle("rotar");
  const dark = document.body.classList.contains("dark-mode");
  if (icon) icon.src = dark ? "img/claro.ico" : "img/oscuro.ico";
}

// 15. Descarga a Excel (sin resaltado)
function descargarArchivo() {
  const overlay = document.getElementById("overlay");
  const textoOv = document.getElementById("overlay-text");
  if (overlay && textoOv) {
    textoOv.textContent = "Generando archivo…";
    overlay.style.display = "flex";
  }

  guardarTipificacion();

  setTimeout(() => {
    const original = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    const updated = original.map(row => {
      const m = matchingRows.find(r =>
        r[keyDoc] === row[keyDoc] &&
        r[keyIncidencia] === row[keyIncidencia] &&
        r[keyTextoIncidencia] === row[keyTextoIncidencia] &&
        r[keyEntrega] === row[keyEntrega]
      );
      if (m) {
        row["TIPIFICACIÓN"] = m["TIPIFICACIÓN"] || "";
        row["OBSERVACIÓN"] = m["OBSERVACIÓN"] || "";
      }
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(updated);
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws, "Hoja1");
    XLSX.writeFile(wb2, "archivo_actualizado.xlsx");

    if (overlay) overlay.style.display = "none";
  }, 100);
}
