let workbook, worksheet, matchingRows = [], currentIndex = 0;
let keyAgente = "", keyDoc = "", keyIncidencia = "", keyTextoIncidencia = "", keyEntrega = "";
let fileName = "", db, archivoPendiente = null, modalArchivo;

// Inicializa IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tipificacion_db", 1);
    request.onerror = () => reject("Error al abrir IndexedDB");
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains("gestiones")) {
        db.createObjectStore("gestiones", { keyPath: "fileName" });
      }
    };
  });
}

function saveSession() {
  if (!db || !fileName) return;
  const data = { fileName, currentIndex, matchingRows };
  const tx = db.transaction("gestiones", "readwrite");
  tx.objectStore("gestiones").put(data);
}

function loadSession(nombreArchivo) {
  return new Promise((resolve) => {
    const tx = db.transaction("gestiones", "readonly");
    tx.objectStore("gestiones").get(nombreArchivo).onsuccess = e =>
      resolve(e.target.result);
  });
}

function clearPreviousSessions(nuevoNombre) {
  const tx = db.transaction("gestiones", "readwrite");
  tx.objectStore("gestiones").getAllKeys().onsuccess = e => {
    e.target.result.forEach(k => {
      if (k !== nuevoNombre) tx.objectStore("gestiones").delete(k);
    });
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  await initDB();

  const agentName = localStorage.getItem("agentName") || "";
  document.getElementById("agentDisplay").textContent = agentName;

  document.getElementById("fileInput").addEventListener("change", handleFile);

  const confirmarCambio = document.getElementById("confirmarCambio");
  if (confirmarCambio) {
    confirmarCambio.addEventListener("click", () => {
      if (modalArchivo) modalArchivo.hide();
      if (archivoPendiente) {
        cargarArchivo(archivoPendiente);
        archivoPendiente = null;
      }
    });
  }
});

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (fileName && matchingRows.length > 0 && file.name !== fileName) {
    archivoPendiente = file;
    if (!modalArchivo) {
      modalArchivo = new bootstrap.Modal(document.getElementById("modalArchivo"));
    }
    modalArchivo.show();
    return;
  }

  cargarArchivo(file);
}

function cargarArchivo(file) {
  fileName = file.name;
  document.getElementById("tituloArchivo").textContent = `Archivo: ${fileName}`;
  clearPreviousSessions(fileName);

  const overlay = document.getElementById("overlay");
  if (overlay) overlay.style.display = "flex";

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = new Uint8Array(event.target.result);
      workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      worksheet = workbook.Sheets[sheetName];

      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      const columnas = Object.keys(jsonData[0] || {});

      keyAgente = columnas.find(k => k.toLowerCase().includes("agente")) || "";
      keyIncidencia = columnas.find(k => k.toLowerCase().includes("inci")) || "Nº Incidencia";
      keyDoc = columnas.find(k => k.toLowerCase().includes("doc")) || "Doc. Comercial";
      keyEntrega = columnas.find(k => k.toLowerCase().includes("entrega")) || "Entrega";
      keyTextoIncidencia = columnas.find(k => k.toLowerCase().includes("texto")) || "Texto Incidencia";
      

      const agentName = localStorage.getItem("agentName") || "";
      let filas;
if (agentName.toLowerCase() === "todo") {
  filas = jsonData; // Mostrar todo sin filtrar
} else {
  filas = jsonData.filter(row =>
    row[keyAgente]?.toString().trim().toLowerCase() === agentName.toLowerCase()
  );
}


      // Si no hay coincidencias, mostrar mensaje y botón para volver
      if (filas.length === 0) {
        matchingRows = [];
        currentIndex = 0;
        document.getElementById("infoFila").innerHTML = `
          <p class='text-danger fw-bold'>🚫 Este archivo no contiene casos para el agente.</p>
          <button class="btn btn-warning btn-sm" onclick="volverAInicio()">
  🔄 Volver
</button>

        `;
        document.getElementById("restantes").textContent = "0";
        if (overlay) overlay.style.display = "none";
        return;
      }

      const saved = await loadSession(fileName);
      currentIndex = saved?.currentIndex || 0;
      matchingRows = saved?.matchingRows || filas;

      mostrarFila();
      actualizarContador();
    } finally {
      if (overlay) overlay.style.display = "none";
    }
  };

  reader.readAsArrayBuffer(file);
}

function mostrarFila() {
  if (currentIndex >= matchingRows.length) {
    document.getElementById("infoFila").innerHTML = "<p>¡No hay más filas para mostrar!</p>";
    return;
  }

  const fila = matchingRows[currentIndex];

  document.getElementById("infoFila").innerHTML = `
    <p><strong>${keyIncidencia}:</strong> ${fila[keyIncidencia] || "N/A"}</p>
    <p><strong>${keyDoc}:</strong> ${fila[keyDoc] || "N/A"}</p>
    <p><strong>${keyEntrega}:</strong> ${fila[keyEntrega] || "N/A"}</p>
    <p><strong>${keyTextoIncidencia}:</strong> ${fila[keyTextoIncidencia] || "N/A"}</p>    
  `;

  const select = document.getElementById("tipificacion");
  select.value = fila["TIPIFICACIÓN"] || "";
}

function guardarTipificacion() {
  if (currentIndex >= matchingRows.length) return;

  const select = document.getElementById("tipificacion");
  const tipificacion = select.value.trim();
  const fila = matchingRows[currentIndex];

  if (tipificacion === "") {
    fila["OBSERVACIÓN"] = "NO PERMITE GESTION";
    delete fila["TIPIFICACIÓN"];
  } else {
    fila["TIPIFICACIÓN"] = tipificacion;
    delete fila["OBSERVACIÓN"];
  }

  const msg = document.getElementById("mensajeGuardado");
  if (msg) {
    msg.textContent = "✅ Tipificación guardada";
    msg.style.display = "inline";
    setTimeout(() => { msg.style.display = "none"; }, 3000);
  }

  saveSession();
}

function siguienteFila() {
  if (currentIndex < matchingRows.length) {
    guardarTipificacion();
    currentIndex++;
    mostrarFila();
    actualizarContador();
  }
}

function filaAnterior() {
  if (currentIndex > 0) {
    guardarTipificacion();
    currentIndex--;
    mostrarFila();
    actualizarContador();
  } else {
    const msg = document.getElementById("mensajeGuardado");
    if (msg) {
      msg.textContent = "Ya estás en la primera fila";
      msg.style.display = "inline";
      setTimeout(() => { msg.style.display = "none"; }, 2500);
    }
  }
}

function actualizarContador() {
  const restantes = matchingRows.length - currentIndex;
  document.getElementById("restantes").textContent = restantes;
}

function descargarArchivo() {
  const overlay = document.getElementById("overlay");
  if (overlay) overlay.style.display = "flex";

  guardarTipificacion();

  const originalData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  const updatedData = originalData.map(row => {
    const match = matchingRows.find(r =>
      r[keyDoc] === row[keyDoc] &&
      r[keyIncidencia] === row[keyIncidencia] &&
      r[keyTextoIncidencia] === row[keyTextoIncidencia] &&
      r[keyEntrega] === row[keyEntrega]
    );
    if (match) {
      row["TIPIFICACIÓN"] = match["TIPIFICACIÓN"] || "";
      row["OBSERVACIÓN"] = match["OBSERVACIÓN"] || "";
    }
    return row;
  });

  const updatedSheet = XLSX.utils.json_to_sheet(updatedData);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, updatedSheet, workbook.SheetNames[0]);

  setTimeout(() => {
    XLSX.writeFile(newWorkbook, "archivo_actualizado.xlsx");
    if (overlay) overlay.style.display = "none";
  }, 100); // Pequeño retardo para que el overlay aparezca antes del bloqueo del navegador
}


function volverAInicio() {
  localStorage.removeItem("agentName");
  window.location.href = "index.html";
}

document.getElementById("modoOscuroBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");

  const icono = document.getElementById("iconoTema");
  icono.classList.toggle("rotar");

  const enModoOscuro = document.body.classList.contains("dark-mode");
  icono.src = enModoOscuro ? "img/claro.ico" : "img/oscuro.ico";
  icono.alt = enModoOscuro ? "Modo Claro" : "Modo Oscuro";
});
