// /static/script.js

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('event-form');
    // Referencias a SELECTS
    const departmentSelect = document.getElementById('department-select');
    const citySelect = document.getElementById('city-select');

    // Selector de formato
    const formatSelect = document.getElementById('result-format-select');

    const eventOutput = document.getElementById('event-output');
    const loadingIndicator = document.getElementById('loading-indicator');

    // NUEVAS REFERENCIAS DE EXPORTACIÓN
    const exportControls = document.getElementById('export-controls');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const exportXlsxBtn = document.getElementById('export-xlsx-btn');

    // Variable para almacenar los datos de la última tabla generada
    let currentEventsData = [];

    // Asumiendo que COLOMBIA_DIVISIONS está disponible desde colombia_data.js

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

    // --- Lógica de Manejo de Exportación ---

    function handleExport(format) {
        if (currentEventsData.length === 0) {
            alert('No hay datos de eventos para exportar. Por favor, realiza una consulta en Vista Tabla primero.');
            return;
        }

        // Realiza una petición POST al endpoint de exportación
        fetch(`/export/${format}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ events: currentEventsData })
        })
        .then(response => {
            if (response.ok) {
                // Descargar el archivo
                return response.blob().then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    // El nombre del archivo se define en Flask, pero si falla, usamos un default:
                    const filename = response.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || `analisis_eventos.${format}`;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                });
            } else {
                 // Manejar errores de exportación (ej: error 400 si la lista está vacía)
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

        // 1. Recolectar datos y validar
        const date = document.getElementById('date-select').value;
        const department = departmentSelect.value;
        const city = citySelect.value;
        const resultFormat = formatSelect.value;

        if (!date || !department || !city) {
            eventOutput.innerHTML = `<div class="alert alert-warning" role="alert"><strong>Atención:</strong> Por favor, selecciona la fecha, el departamento y la ciudad.</div>`;
            currentEventsData = [];
            exportControls.classList.add('d-none');
            return;
        }

        // 2. Preparar la interfaz
        eventOutput.innerHTML = '';
        loadingIndicator.classList.remove('d-none');
        exportControls.classList.add('d-none');
        currentEventsData = [];

        // 3. Realizar la petición POST
        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fecha: date, departamento: department, ciudad: city, format: resultFormat })
            });

            const data = await response.json();

            // 4. Procesar la respuesta
            if (data.error) {
                eventOutput.innerHTML = `<div class="alert alert-danger" role="alert"><strong>Error:</strong> ${data.error}</div>`;
            } else if (data.type === 'table' && data.result && data.result.length > 0) {
                // Vista Tabla
                eventOutput.innerHTML = buildEventsTable(data.result, date.substring(0, 7));

                // Almacenar datos y mostrar control de exportación
                currentEventsData = data.result;
                exportControls.classList.remove('d-none');

            } else if (data.type === 'detail' && data.result) {
                // Vista Detallada
                eventOutput.innerHTML = buildDetailView(data.result, date.substring(0, 7));
                currentEventsData = [];
                exportControls.classList.add('d-none');
            } else {
                 eventOutput.innerHTML = `<div class="alert alert-info" role="alert">No se identificaron eventos comerciales significativos para ${city} en el mes seleccionado.</div>`;
                 currentEventsData = [];
                 exportControls.classList.add('d-none');
            }

        } catch (error) {
            console.error('Error en la comunicación con el servidor:', error);
            eventOutput.innerHTML = `<div class="alert alert-danger" role="alert">Hubo un problema de conexión con el servidor.</div>`;
        } finally {
            loadingIndicator.classList.add('d-none');
        }
    });
});

// --- Funciones de Renderizado ---

function buildDetailView(text, monthYear) {
    const paragraphs = text.split('\n').filter(p => p.trim() !== '').map(p => `<p>${p.trim()}</p>`).join('');

    return `
        <h6 class="text-primary mb-3">Análisis Detallado para ${monthYear}</h6>
        <div class="bg-white p-3 border rounded shadow-sm">
            ${paragraphs}
        </div>
    `;
}

function buildEventsTable(events, monthYear) {
    let tableHtml = `
        <h6 class="text-primary mb-3">Eventos Analizados para ${monthYear}</h6>
        <div class="table-responsive">
            <table class="table table-striped table-hover table-sm">
                <thead class="table-dark">
                    <tr>
                        <th>Fecha</th>
                        <th>Evento Clave</th>
                        <th>Impacto</th>
                        <th>Descripción (para El Templo de la Moda)</th>
                    </tr>
                </thead>
                <tbody>
    `;

    events.forEach(event => {
        const impactText = (event.impact || '').toLowerCase();
        let impactClass = 'bg-secondary';

        if (impactText.includes('positivo')) {
            impactClass = 'bg-success';
        } else if (impactText.includes('negativo')) {
            impactClass = 'bg-danger';
        } else if (impactText.includes('neutro')) {
             impactClass = 'bg-warning text-dark';
        }

        tableHtml += `
            <tr>
                <td>${event.date || 'N/A'}</td>
                <td><strong>${event.name || 'Sin nombre'}</strong></td>
                <td><span class="badge ${impactClass}">${event.impact || 'N/A'}</span></td>
                <td>${event.description || 'Sin descripción de impacto.'}</td>
            </tr>
        `;
    });

    tableHtml += `
                </tbody>
            </table>
        </div>
    `;

    return tableHtml;
}