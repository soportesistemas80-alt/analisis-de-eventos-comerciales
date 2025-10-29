// /static/script.js

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('event-form');
    // Referencias a SELECTS
    const departmentSelect = document.getElementById('department-select');
    const citySelect = document.getElementById('city-select');

    // Selectores de Período y Formato
    const periodoTabs = document.getElementById('periodo-tab');
    const hiddenPeriodoType = document.getElementById('hidden-periodo-type'); // <--- CLAVE DE LA CORRECCIÓN
    const dateSelect = document.getElementById('date-select');
    const yearSelect = document.getElementById('year-select');
    const formatSelectGroup = document.getElementById('format-select-group');
    const formatSelect = document.getElementById('result-format-select');

    const eventOutput = document.getElementById('event-output');
    const loadingIndicator = document.getElementById('loading-indicator');
    const annualWarningText = document.getElementById('annual-warning-text');
    const periodoDisplay = document.getElementById('periodo-display');

    // Referencias de Exportación
    const exportControls = document.getElementById('export-controls');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const exportXlsxBtn = document.getElementById('export-xlsx-btn');

    // Variable para almacenar los datos de la última tabla/reporte generado
    let currentEventsData = [];

    // --- Lógica de Llenado de SELECTS ---

    function populateSelect(selectElement, dataArray, defaultText) {
        selectElement.innerHTML = `<option value="">${defaultText}</option>`;
        dataArray.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            selectElement.appendChild(option);
        });
    }

    function populateDepartments() {
        // COLOMBIA_DIVISIONS viene de colombia_data.js
        const departments = Object.keys(COLOMBIA_DIVISIONS).sort();
        populateSelect(departmentSelect, departments, "Selecciona un Departamento");
    }

    function populateCities(department) {
        citySelect.disabled = true;

        if (department && COLOMBIA_DIVISIONS[department]) {
            const cities = COLOMBIA_DIVISIONS[department].sort();
            populateSelect(citySelect, cities, "Selecciona una Ciudad");
            citySelect.disabled = false;
        } else {
             citySelect.innerHTML = '<option value="">Selecciona primero un Departamento</option>';
        }
    }

    departmentSelect.addEventListener('change', (e) => {
        const selectedDepartment = e.target.value;
        populateCities(selectedDepartment);
    });

    populateDepartments();

    // --- Lógica de Alternancia de Período con Tabs ---

    periodoTabs.addEventListener('click', (e) => {
        const button = e.target.closest('.nav-link');
        if (!button) return;

        const type = button.dataset.periodoType;

        // 1. Actualizar el campo oculto que Flask leerá
        hiddenPeriodoType.value = type;

        // 2. Controlar la visibilidad y requerimiento de los campos de entrada
        if (type === 'month') {
            dateSelect.required = true;
            yearSelect.required = false;

            formatSelectGroup.classList.remove('d-none'); // Mostrar selector de formato
            annualWarningText.classList.add('d-none');
            periodoDisplay.textContent = 'Mes Seleccionado';

            // Asegurar que el campo Year no tenga valor
            yearSelect.value = '';

        } else { // type === 'year'
            dateSelect.required = false;
            yearSelect.required = true;

            formatSelectGroup.classList.add('d-none'); // Ocultar selector de formato (Anual siempre es reporte)
            annualWarningText.classList.remove('d-none');
            periodoDisplay.textContent = 'Año Completo';

            // Asegurar que el campo Date no tenga valor
            dateSelect.value = '';
        }
    });


    // --- Lógica de Manejo de Exportación ---

    function handleExport(format) {
        // En consulta anual, se exporta TODO el reporte (todos los meses concatenados)
        let exportData = currentEventsData;
        if (hiddenPeriodoType.value === 'year') {
             // Aplanar el reporte anual (una lista de eventos de 12 meses)
            exportData = currentEventsData.flatMap(monthReport =>
                monthReport.events.map(event => ({
                    Mes: monthReport.month_name,
                    ...event
                }))
            );
        }

        if (exportData.length === 0) {
            alert('No hay datos de eventos para exportar.');
            return;
        }

        // Realiza una petición POST al endpoint de exportación
        fetch(`/export/${format}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ events: exportData })
        })
        .then(response => {
            if (response.ok) {
                return response.blob().then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const filename = response.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || `analisis_eventos.${format}`;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                });
            } else {
                 return response.json().then(errorData => {
                    alert(`Error al exportar a ${format.toUpperCase()}: ${errorData.error || 'Error desconocido'}`);
                 }).catch(() => {
                    alert(`Error de red al exportar.`);
                 });
            }
        })
        .catch(error => {
            console.error('Error durante la exportación:', error);
            alert('Hubo un error de red o de servidor al intentar exportar.');
        });
    }

    // Asignar los listeners a los botones de exportación
    exportCsvBtn.addEventListener('click', () => handleExport('csv'));
    exportXlsxBtn.addEventListener('click', () => handleExport('xlsx'));


    // --- Lógica del Formulario: Envío y Renderizado ---

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Recolectar datos
        // **CORRECCIÓN CLAVE:** Leer del campo hidden, que siempre tiene el valor correcto del tab activo.
        const periodoType = hiddenPeriodoType.value;

        const department = departmentSelect.value;
        const city = citySelect.value;
        const resultFormat = formatSelect.value;

        let payload = { departamento: department, ciudad: city, format: resultFormat, periodo_type: periodoType };
        let displayPeriodo = '';

        if (periodoType === 'month') {
            payload.fecha = dateSelect.value;
            if (!payload.fecha) {
                 eventOutput.innerHTML = `<div class="alert alert-warning" role="alert"><strong>Atención:</strong> Por favor, selecciona una fecha en el modo mensual.</div>`;
                 return;
            }
            displayPeriodo = payload.fecha.substring(0, 7);
        } else { // 'year'
            payload.year_select = yearSelect.value;
            if (!payload.year_select) {
                 eventOutput.innerHTML = `<div class="alert alert-warning" role="alert"><strong>Atención:</strong> Por favor, ingresa un año en el modo anual.</div>`;
                 return;
            }
            displayPeriodo = payload.year_select;
            // La consulta anual fuerza la vista de reporte
            payload.format = 'table';
        }

        if (!department || !city) {
            eventOutput.innerHTML = `<div class="alert alert-warning" role="alert"><strong>Atención:</strong> Por favor, selecciona el departamento y la ciudad.</div>`;
            return;
        }

        // 2. Preparar la interfaz
        eventOutput.innerHTML = '';
        loadingIndicator.classList.remove('d-none');
        exportControls.classList.add('d-none');
        currentEventsData = [];
        periodoDisplay.textContent = periodoType === 'year' ? displayPeriodo : displayPeriodo + ' (Mensual)';

        // Mostrar advertencia anual si aplica
        if (periodoType === 'year') {
            annualWarningText.classList.remove('d-none');
        } else {
            annualWarningText.classList.add('d-none');
        }


        // 3. Realizar la petición POST
        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            // 4. Procesar la respuesta
            if (data.error) {
                eventOutput.innerHTML = `<div class="alert alert-danger" role="alert"><strong>Error:</strong> ${data.error}</div>`;
                periodoDisplay.textContent = 'Error';
            } else if (data.period === 'month') {
                if (data.type === 'table' && data.result && data.result.length > 0) {
                    eventOutput.innerHTML = buildEventsTable(data.result, displayPeriodo);
                    currentEventsData = data.result;
                    exportControls.classList.remove('d-none');
                } else if (data.type === 'detail' && data.result) {
                    eventOutput.innerHTML = buildDetailView(data.result, displayPeriodo);
                    currentEventsData = [];
                    exportControls.classList.add('d-none');
                } else {
                     eventOutput.innerHTML = `<div class="alert alert-info" role="alert">No se identificaron eventos significativos para ${city} en el mes seleccionado.</div>`;
                     currentEventsData = [];
                     exportControls.classList.add('d-none');
                }
            } else if (data.period === 'year' && data.type === 'yearly_report' && data.result && data.result.length > 0) {
                // Vista Anual (Consolidada)
                eventOutput.innerHTML = buildYearlyReport(data.result, displayPeriodo);
                currentEventsData = data.result; // Almacenar el reporte de 12 meses
                exportControls.classList.remove('d-none');

            } else {
                 eventOutput.innerHTML = `<div class="alert alert-info" role="alert">No se pudo generar el reporte anual para ${displayPeriodo}.</div>`;
                 currentEventsData = [];
                 exportControls.classList.add('d-none');
            }

        } catch (error) {
            console.error('Error en la comunicación con el servidor:', error);
            eventOutput.innerHTML = `<div class="alert alert-danger" role="alert">Hubo un problema de conexión con el servidor.</div>`;
        } finally {
            loadingIndicator.classList.add('d-none');
            annualWarningText.classList.add('d-none'); // Esconder siempre al finalizar
        }
    });
});

// --- Función de Renderizado Anual ---

function buildYearlyReport(yearlyReport, year) {
    // Usar el color primario (gris oscuro) para el título
    let reportHtml = `<h6 class="text-primary fw-bold mb-4">Reporte Anual de Eventos Clave para ${year}</h6>`;

    yearlyReport.forEach(monthReport => {
        // Usar la clase 'custom-month-card' definida en CSS para el estilo sobrio
        reportHtml += `
            <div class="card mb-3 custom-month-card">
                <div class="card-header">
                    <h6 class="mb-0">${monthReport.month_name} (${year})</h6>
                </div>
                <div class="card-body p-2">
                    ${monthReport.events && monthReport.events.length > 0
                        ? buildEventsTableBody(monthReport.events)
                        : `<p class="text-muted m-2 small">No se identificaron eventos clave para este mes.</p>`
                    }
                </div>
            </div>
        `;
    });
    return reportHtml;
}

// --- Funciones de Renderizado (Ajustadas) ---

function buildDetailView(text, monthYear) {
    const paragraphs = text.split('\n').filter(p => p.trim() !== '').map(p => `<p>${p.trim()}</p>`).join('');

    return `
        <h6 class="text-primary fw-bold mb-3">Análisis Detallado para ${monthYear}</h6>
        <div class="bg-white p-3 border rounded">
            ${paragraphs}
        </div>
    `;
}

// Genera solo el cuerpo de la tabla para reutilizar en el reporte anual
function buildEventsTableBody(events) {
    let tbodyHtml = events.map(event => {
        const impactText = (event.impact || '').toLowerCase();
        let impactClass = 'badge-secondary';

        if (impactText.includes('positivo')) {
            impactClass = 'bg-success';
        } else if (impactText.includes('negativo')) {
            impactClass = 'bg-danger';
        } else if (impactText.includes('neutro')) {
             impactClass = 'bg-warning text-dark';
        }

        return `
            <tr>
                <td style="width: 15%;">${event.date || 'N/A'}</td>
                <td style="width: 25%;"><strong>${event.name || 'Sin nombre'}</strong></td>
                <td style="width: 15%;"><span class="badge ${impactClass}">${event.impact || 'N/A'}</span></td>
                <td style="width: 45%;">${event.description || 'Sin descripción de impacto.'}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="table-responsive">
            <table class="table table-sm table-borderless small mb-0">
                <thead class="text-muted small">
                    <tr>
                        <th style="width: 15%;">Fecha</th>
                        <th style="width: 25%;">Evento Clave</th>
                        <th style="width: 15%;">Impacto</th>
                        <th style="width: 45%;">Descripción</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
            </table>
        </div>
    `;
}

// Renderizado principal de la tabla mensual
function buildEventsTable(events, monthYear) {
    return `
        <h6 class="text-primary fw-bold mb-3">Eventos Analizados para ${monthYear}</h6>
        ${buildEventsTableBody(events)}
    `;
}