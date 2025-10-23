import os
import json
import io
import pandas as pd

from flask import Flask, render_template, request, jsonify, send_file
from dotenv import load_dotenv
from google import genai
from google.genai.errors import APIError

# --- CONFIGURACIÓN INICIAL ---

load_dotenv()
app = Flask(__name__)

try:
    API_KEY = os.getenv("GEMINI_API_KEY")
    if not API_KEY:
        print("ADVERTENCIA: GEMINI_API_KEY no se encontró. Las llamadas a la API fallarán.")
        client = None
    else:
        client = genai.Client(api_key=API_KEY)
    MODEL_NAME = 'gemini-2.5-flash'

except Exception as e:
    print(f"Error al inicializar el cliente Gemini: {e}")
    client = None


# --- RUTA PRINCIPAL ---

@app.route('/')
def index():
    """Sirve la página principal con el formulario."""
    return render_template('index.html')


# --- ENDPOINT DE LA API ---

@app.route('/api/analyze', methods=['POST'])
def analyze_events():
    """
    Recibe los datos del frontend y solicita el análisis a Gemini en el formato especificado.
    """
    if not client:
        return jsonify({
            "error": "El cliente Gemini no está inicializado. Revisa tu clave API.",
            "type": "error",
            "result": None
        }), 500

    data = request.get_json()
    fecha = data.get('fecha')
    departamento = data.get('departamento')
    ciudad = data.get('ciudad')
    result_format = data.get('format', 'table')

    if not all([fecha, departamento, ciudad]):
        return jsonify({
            "error": "Faltan datos (fecha, departamento o ciudad).",
            "type": "error",
            "result": None
        }), 400

    try:
        year, month, day = fecha.split('-')
    except ValueError:
        return jsonify({"error": "Formato de fecha inválido. Usar YYYY-MM-DD.", "type": "error", "result": None}), 400

    # --- CONSTRUCCIÓN DINÁMICA DEL PROMPT Y ESQUEMA DE RESPUESTA ---

    if result_format == 'table':
        # Solicitud de formato JSON para la Vista Tabla
        prompt = f"""
        Eres un analista de negocios. Identifica los **eventos comerciales** más significativos para una empresa de moda colombiana como 'El Templo De La Moda SAS' en la ciudad de {ciudad}, departamento de {departamento}, con enfoque en el **mes de {month}/{year}**.

        Los eventos deben causar picos de ventas o caídas significativas. No incluyas eventos irrelevantes.

        Devuelve una lista de **3 a 5 eventos relevantes** en formato **JSON** estricto, sin preámbulos, explicaciones o texto adicional.

        El formato JSON DEBE ser:
        {{
          "events": [
            {{
              "date": "YYYY-MM-DD",
              "name": "Nombre del Evento",
              "impact": "Positivo, Negativo o Neutro", 
              "description": "Breve justificación del impacto comercial en el sector moda."
            }},
            // ... (más objetos de eventos)
          ]
        }}
        """
    else:  # result_format == 'detail'
        # Solicitud de formato de texto plano para la Vista Detallada
        prompt = f"""
        Eres un analista de negocios experto. Realiza un análisis detallado del **impacto comercial** de eventos clave en la ciudad de {ciudad}, departamento de {departamento} para el sector moda (como 'El Templo De La Moda SAS') durante el **mes de {month}/{year}**.

        El análisis debe ser un texto de 3-4 párrafos que:
        1. Identifique 3 a 5 eventos relevantes.
        2. Explique el impacto potencial (positivo o negativo) de cada evento.
        3. Ofrezca una recomendación de negocio clave para la empresa.

        No uses formato JSON ni listas. El resultado debe ser texto limpio.
        """

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt
        )
        response_text = response.text.strip()

        if result_format == 'table':
            # Procesa la respuesta JSON
            if response_text.startswith('```json'):
                json_string = response_text.replace('```json', '').replace('```', '').strip()
            else:
                json_start = response_text.find('{')
                json_end = response_text.rfind('}')
                if json_start != -1 and json_end != -1:
                    json_string = response_text[json_start: json_end + 1]
                else:
                    json_string = response_text

            analysis_data = json.loads(json_string)

            if 'events' not in analysis_data or not isinstance(analysis_data['events'], list):
                raise ValueError("El JSON devuelto no tiene el formato esperado (clave 'events').")

            return jsonify({
                "type": "table",
                "result": analysis_data['events'],
                "error": None
            })

        else:  # result_format == 'detail'
            # Procesa la respuesta de texto
            return jsonify({
                "type": "detail",
                "result": response_text,
                "error": None
            })


    except APIError as e:
        error_message = str(e)
        try:
            error_data = json.loads(error_message.split(' ', 1)[1])
            api_detail = error_data.get('error', {}).get('message', 'Error desconocido de la API.')
            http_code = error_data.get('error', {}).get('code', 500)

            if http_code == 503:
                user_friendly_error = f"Error 503: Sobrecarga del modelo. Por favor, inténtalo de nuevo en unos minutos. ({api_detail})"
            elif http_code == 429:
                user_friendly_error = f"Error 429: Límite de cuota excedido. Por favor, revisa tu plan de API. ({api_detail})"
            elif http_code == 400:
                user_friendly_error = f"Error 400: Solicitud inválida. El prompt o la entrada son incorrectos. ({api_detail})"
            else:
                user_friendly_error = f"Error de la API ({http_code}): {api_detail}"

        except (IndexError, json.JSONDecodeError):
            user_friendly_error = "Error genérico de la API de Gemini. Revisa la clave API o la conexión."

        app.logger.error(f"Error de la API de Gemini: {e}")
        return jsonify({
            "error": user_friendly_error,
            "type": "error",
            "result": None
        }), 500

    except (ValueError, json.JSONDecodeError) as e:
        app.logger.error(f"Error en el procesamiento del JSON: {e}")
        return jsonify({
            "error": f"Gemini devolvió un formato incorrecto. Intenta de nuevo. Detalles internos: {e}",
            "type": "error",
            "result": None
        }), 500
    except Exception as e:
        app.logger.error(f"Error inesperado: {e}")
        return jsonify({
            "error": "Ocurrió un error inesperado en el servidor.",
            "type": "error",
            "result": None
        }), 500


# --- NUEVAS RUTAS DE EXPORTACIÓN ---

@app.route('/export/csv', methods=['POST'])
def export_csv():
    data = request.get_json()
    events = data.get('events', [])

    if not events:
        return jsonify({"error": "No hay datos de eventos para exportar."}), 400

    df = pd.DataFrame(events)

    # Crear un buffer en memoria para CSV
    output = io.StringIO()
    # encoding='utf-8-sig' maneja correctamente caracteres especiales
    df.to_csv(output, index=False, encoding='utf-8-sig')
    output.seek(0)

    buffer = io.BytesIO(output.getvalue().encode('utf-8-sig'))

    # Devolver el archivo CSV
    return send_file(
        buffer,
        mimetype='text/csv',
        as_attachment=True,
        download_name='analisis_eventos.csv'
    )


@app.route('/export/xlsx', methods=['POST'])
def export_xlsx():
    data = request.get_json()
    events = data.get('events', [])

    if not events:
        return jsonify({"error": "No hay datos de eventos para exportar."}), 400

    df = pd.DataFrame(events)

    # Crear un buffer en memoria para XLSX
    output = io.BytesIO()

    # engine='openpyxl' asegura la compatibilidad moderna con XLSX
    df.to_excel(output, index=False, sheet_name='Eventos Comerciales', engine='openpyxl')
    output.seek(0)

    # Devolver el archivo XLSX
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name='analisis_eventos.xlsx'
    )


# --- EJECUCIÓN DEL SERVIDOR ---

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)