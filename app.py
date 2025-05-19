from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import json
import os
import uuid
from datetime import datetime, timezone
import threading
import time
from werkzeug.utils import secure_filename
import sys # Import sys for logging
import traceback # Import traceback to print detailed error info

print("Script app.py started.") # Log start of script

# --- Configuration ---
# Define folders for audio files relative to the script's directory
# Get the absolute path of the directory containing this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploaded_audio')
DEFAULT_AUDIO_FOLDER = os.path.join(BASE_DIR, 'default_audio')
DATA_FILE = os.path.join(BASE_DIR, 'reminders.json') # Data file in the base directory

# Define a default audio filename (ensure this file exists in DEFAULT_AUDIO_FOLDER)
DEFAULT_AUDIO_FILENAME = 'default_beep.mp3'

print(f"Script app.py started. Base directory: {BASE_DIR}")
print(f"UPLOAD_FOLDER: {UPLOAD_FOLDER}")
print(f"DEFAULT_AUDIO_FOLDER: {DEFAULT_AUDIO_FOLDER}")
print(f"DATA_FILE: {DATA_FILE}")


# Ensure audio folders exist
try:
    print(f"Ensuring existence of folders: {UPLOAD_FOLDER}, {DEFAULT_AUDIO_FOLDER}")
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(DEFAULT_AUDIO_FOLDER, exist_ok=True)
    print(f"Folders checked/created successfully.")
except OSError as e:
    print(f"Error creating folders: {e}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr) # Print traceback for folder creation error
    sys.exit(1) # Exit if folders cannot be created

print("Configuring Flask...")
# Configure Flask
# static_folder='' and static_url_path='' serve files from BASE_DIR
# This tells Flask to look for static files (like index.html) in the BASE_DIR
app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['DEFAULT_AUDIO_FOLDER'] = DEFAULT_AUDIO_FOLDER


print("Configuring SocketIO...")
# Configure SocketIO - cors_allowed_origins="*" allows connections from any origin
# In a production environment, you should restrict this to your frontend's origin(s)
# Using gevent as the async mode, which is compatible with Flask-SocketIO
try:
    # Note: async_mode='gevent' requires gevent and gevent-websocket to be installed
    # If you encounter issues, you can remove async_mode or try 'threading'
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent')
    print("SocketIO configured successfully with async_mode='gevent'.")
except Exception as e:
    print(f"Error configuring SocketIO with gevent: {e}", file=sys.stderr)
    print("Falling back to threading async mode. Install gevent and gevent-websocket for better performance.", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    # Fallback to threading async mode if gevent fails
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')


# --- Data Loading and Saving ---
# Function to load reminders from the file
def load_reminders():
    print(f"Attempting to load reminders from {DATA_FILE}")
    if not os.path.exists(DATA_FILE):
        print(f"Data file not found: {DATA_FILE}. Returning empty list.")
        return []
    try:
        # Open and read the data file with utf-8 encoding
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            # Load JSON data from the file
            reminders = json.load(f)
            print(f"Loaded {len(reminders)} reminders from {DATA_FILE}")
            return reminders
    except json.JSONDecodeError:
        print(f"Error decoding JSON from {DATA_FILE}. File might be corrupt. Returning empty list.", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return []
    except IOError as e:
        print(f"Error reading data file {DATA_FILE}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return []
    except Exception as e:
        print(f"Unexpected error loading reminders from {DATA_FILE}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return []


# Function to save reminders to the file
def save_reminders(reminders):
    print(f"Attempting to save {len(reminders)} reminders to {DATA_FILE}")
    try:
        # Sort reminders by time before saving for consistent order
        reminders.sort(key=lambda r: r.get('time', ''))
        # Open the data file for writing with utf-8 encoding
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            # Dump the reminders list as JSON to the file, with indentation for readability
            json.dump(reminders, f, indent=4, ensure_ascii=False) # ensure_ascii=False to save non-ASCII chars directly
        print(f"Saved {len(reminders)} reminders to {DATA_FILE}")
    except IOError as e:
        print(f"Error saving reminders to file {DATA_FILE}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
    except Exception as e:
        print(f"Unexpected error saving reminders to {DATA_FILE}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


# --- Background Task ---
# Background task to check for due reminders using SocketIO's background tasks
# Using SocketIO's start_background_task is preferred with async modes
def reminder_checker_task():
    print("SocketIO background reminder checker task started.")
    # Ensure this task runs within the Flask application context
    with app.app_context():
        while True:
            # Check for due reminders every second
            # Use socketio.sleep or time.sleep depending on async_mode
            if socketio.async_mode in ['gevent', 'eventlet']:
                 socketio.sleep(1)
            else:
                 time.sleep(1)

            reminders = load_reminders()
            current_time = datetime.now(timezone.utc)
            due_reminders = []
            remaining_reminders = []

            for reminder in reminders:
                try:
                    # Parse the reminder time string
                    # Ensure time parsing is robust
                    time_str = reminder.get('time')
                    if not time_str:
                         print(f"Warning: Reminder ID {reminder.get('id', 'N/A')} has no time. Skipping.", file=sys.stderr)
                         remaining_reminders.append(reminder)
                         continue

                    # Handle potential missing timezone info gracefully
                    if time_str.endswith('Z'):
                        time_str = time_str.replace('Z', '+00:00')
                    elif '+' not in time_str and '-' not in time_str[1:]: # Simple check for missing offset
                         # Assume UTC if no timezone info provided
                         time_str += '+00:00'


                    reminder_time = datetime.fromisoformat(time_str)

                    if reminder_time <= current_time:
                        # If reminder time is in the past or present, it's due
                        due_reminders.append(reminder)
                    else:
                        # Otherwise, it remains
                        remaining_reminders.append(reminder)
                except (ValueError, KeyError) as e:
                    # Handle cases where reminder time string is invalid or keys are missing
                    print(f"Warning: Could not process reminder data for ID {reminder.get('id', 'N/A')}. Error: {e}. Keeping reminder.", file=sys.stderr)
                    traceback.print_exc(file=sys.stderr)
                    remaining_reminders.append(reminder) # Keep invalid or malformed reminders
                except Exception as e:
                    print(f"Unexpected error processing reminder ID {reminder.get('id', 'N/A')}: {e}", file=sys.stderr)
                    traceback.print_exc(file=sys.stderr)
                    remaining_reminders.append(reminder)


            # If there are due reminders, emit a SocketIO event
            if due_reminders:
                print(f"Due reminders found: {len(due_reminders)}. Emitting 'reminder_due' event.")
                # Emit event to all connected clients with due reminders data
                # We send the full reminder object, which now includes 'audio_filename' and 'audio_type'
                socketio.emit('reminder_due', due_reminders)
                # Save only the remaining reminders back to the file
                save_reminders(remaining_reminders)


# --- SocketIO Event Handlers ---
@socketio.on('connect')
def handle_connect():
    print('Client connected')
    # Start the background task when the first client connects
    # This ensures the checker runs only when there are connected clients
    # Use a flag in app.config or a global variable to track if the task is started
    if not app.config.get('reminder_checker_task_started'):
        print("Starting SocketIO background reminder checker task.")
        try:
            # Use socketio.start_background_task instead of threading.Thread
            socketio.start_background_task(target=reminder_checker_task)
            app.config['reminder_checker_task_started'] = True
            print("SocketIO background reminder checker task started.")
        except Exception as e:
            print(f"Error starting background task: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)


@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

# --- Routes ---
# Route to serve the index.html file from the base directory
@app.route('/')
def serve_index():
    print("Received request for / - Serving index.html from BASE_DIR")
    # Serve the index.html file from the BASE_DIR
    try:
        return send_from_directory(BASE_DIR, 'index.html')
    except FileNotFoundError:
         print(f"index.html not found in base directory: {BASE_DIR}!", file=sys.stderr)
         return "index.html not found", 404
    except Exception as e:
         print(f"Error serving index.html: {e}", file=sys.stderr)
         traceback.print_exc(file=sys.stderr)
         return "Error serving index.html", 500


# Route to serve static files from default_audio folder
@app.route('/default_audio/<filename>')
def serve_default_audio(filename):
    print(f"Received request for /default_audio/{filename}")
    # Secure filename first
    filename = secure_filename(filename)
    try:
        # Ensure file is served from the intended default folder
        print(f"Attempting to serve from: {DEFAULT_AUDIO_FOLDER}")
        return send_from_directory(DEFAULT_AUDIO_FOLDER, filename)
    except FileNotFoundError:
        print(f"Default audio file not found: {filename} in {DEFAULT_AUDIO_FOLDER}", file=sys.stderr)
        return jsonify({"message": "Default audio file not found"}), 404
    except Exception as e:
        print(f"Error serving default audio file {filename}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return jsonify({"message": "Error serving file"}), 500


# Route to serve static files from uploaded_audio folder
@app.route('/uploaded_audio/<filename>')
def serve_uploaded_audio(filename):
    print(f"Received request for /uploaded_audio/{filename}")
    # Secure filename first
    filename = secure_filename(filename)
    try:
        # Ensure file is served from the intended uploaded folder
        print(f"Attempting to serve from: {UPLOAD_FOLDER}")
        return send_from_directory(UPLOAD_FOLDER, filename)
    except FileNotFoundError:
        print(f"Uploaded audio file not found: {filename} in {UPLOAD_FOLDER}", file=sys.stderr)
        return jsonify({"message": "Uploaded audio file not found"}), 404
    except Exception as e:
        print(f"Error serving uploaded audio file {filename}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return jsonify({"message": "Error serving file"}), 500


# New route to get lists of available and uploaded audio files
@app.route('/audio_files', methods=['GET'])
def get_audio_files():
    print("Received GET request for /audio_files")
    available_files = []
    uploaded_files = []

    # Get files from default_audio folder
    try:
        # List files in the default audio folder, filtering out directories
        available_files = [f for f in os.listdir(DEFAULT_AUDIO_FOLDER) if os.path.isfile(os.path.join(DEFAULT_AUDIO_FOLDER, f))]
        print(f"Found {len(available_files)} available audio files.")
    except OSError as e:
        print(f"Error listing files in {DEFAULT_AUDIO_FOLDER}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    # Get files from uploaded_audio folder
    try:
        # List files in the uploaded audio folder, filtering out directories
        uploaded_files = [f for f in os.listdir(UPLOAD_FOLDER) if os.path.isfile(os.path.join(UPLOAD_FOLDER, f))]
        print(f"Found {len(uploaded_files)} uploaded audio files.")
    except OSError as e:
        print(f"Error listing files in {UPLOAD_FOLDER}: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    # Return a dictionary with two lists
    audio_files_info = {"available": available_files, "uploaded": uploaded_files}
    print(f"Returning audio files info: {audio_files_info}")
    return jsonify(audio_files_info), 200


# Route to upload an audio file to the uploaded_audio folder
@app.route('/upload_audio', methods=['POST'])
def upload_audio():
    print("Received POST request for /upload_audio")
    if 'audio_file' not in request.files:
        print("No audio_file part in the request", file=sys.stderr)
        return jsonify({"message": "No audio_file part in the request"}), 400

    audio_file = request.files['audio_file']
    print(f"Received file for upload: {audio_file.filename}")

    # If the user does not select a file, the browser submits an
    # empty file without a filename.
    if audio_file.filename == '':
        print("No selected file for upload", file=sys.stderr)
        return jsonify({"message": "No selected file"}), 400

    if audio_file:
        # Use secure_filename to prevent directory traversal attacks
        filename = secure_filename(audio_file.filename)
        # Create a unique filename to avoid collisions
        unique_filename = str(uuid.uuid4()) + '_' + filename
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
        try:
            print(f"Attempting to save file to: {file_path}")
            audio_file.save(file_path)
            print(f"Audio file uploaded successfully: {file_path}")
            # Return the unique filename and type to the frontend
            return jsonify({"message": "File uploaded successfully", "filename": unique_filename, "audio_type": "uploaded_audio"}), 200 # Return type here
        except IOError as e:
            print(f"Error saving file {file_path}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return jsonify({"message": "Error saving file"}), 500
        except Exception as e:
            print(f"Unexpected error during file upload: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return jsonify({"message": "An unexpected error occurred during upload"}), 500


# Route to delete an audio file from the uploaded_audio folder
@app.route('/uploaded_audio/<filename>', methods=['DELETE'])
def delete_uploaded_audio_route(filename): # Renamed route function to avoid conflict if needed later
    print(f"Received DELETE request for uploaded audio file: {filename}")
    # Use secure_filename for safety
    filename = secure_filename(filename)
    file_path = os.path.join(UPLOAD_FOLDER, filename)

    # Check if the file exists and is in the UPLOAD_FOLDER
    if os.path.exists(file_path) and os.path.isfile(file_path):
        try:
            print(f"Attempting to delete file: {file_path}")
            os.remove(file_path)
            print(f"File deleted successfully: {file_path}")
            return jsonify({"message": "File deleted successfully"}), 200
        except OSError as e:
            print(f"Error deleting file {file_path}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return jsonify({"message": f"Error deleting file: {e}"}), 500
        except Exception as e:
            print(f"Unexpected error during file deletion: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return jsonify({"message": "An unexpected error occurred during deletion"}), 500
    else:
        print(f"File not found in {UPLOAD_FOLDER} for deletion: {filename}", file=sys.stderr)
        return jsonify({"message": "File not found in uploaded folder"}), 404


# Route to get all reminders
@app.route('/reminders', methods=['GET'])
def get_reminders():
    print("Received GET request for /reminders")
    # Load reminders from the file and return as JSON
    reminders = load_reminders()
    print(f"Returning {len(reminders)} reminders.")
    return jsonify(reminders)

# Route to add a new reminder
@app.route('/reminders', methods=['POST'])
def add_reminder():
    print("Received POST request for /reminders")
    # Get the reminder data from the request body (JSON)
    # The frontend now sends audio_filename and audio_type in the JSON body
    new_reminder_data = request.json
    print(f"Received reminder data: {new_reminder_data}")
    if not new_reminder_data or 'text' not in new_reminder_data or 'time' not in new_reminder_data:
        # Return an error if the required fields are missing
        print("Missing text or time in POST request", file=sys.stderr)
        return jsonify({"message": "Missing text or time"}), 400

    reminders = load_reminders()
    # Generate a unique ID for the new reminder
    new_reminder = {
        'id': str(uuid.uuid4()),
        'text': new_reminder_data['text'],
        'time': new_reminder_data['time'], # time_str is already in ISO format from frontend
        'audio_filename': new_reminder_data.get('audio_filename', None), # Ensure audio_filename is present
        'audio_type': new_reminder_data.get('audio_type', None) # Ensure audio_type is present
    }
    print(f"Adding new reminder: {new_reminder}")

    # Append the new reminder to the list
    reminders.append(new_reminder)
    # Save the updated list back to the file
    save_reminders(reminders)
    print(f"Added new reminder: {new_reminder['id']}")
    # Return the newly added reminder with a 201 status code
    return jsonify(new_reminder), 201

# Route to delete a reminder by ID
@app.route('/reminders/<reminder_id>', methods=['DELETE'])
def delete_reminder(reminder_id):
    print(f"Received DELETE request for /reminders/{reminder_id}")
    reminders = load_reminders()
    # Find the reminder to get its audio filename and type before deleting
    reminder_to_delete = next((r for r in reminders if r.get('id') == reminder_id), None)
    print(f"Reminder to delete found: {reminder_to_delete}")

    # Filter out the reminder with the matching ID
    initial_count = len(reminders)
    reminders = [r for r in reminders if r.get('id') != reminder_id]

    if len(reminders) == initial_count:
        # Return an error if no reminder was found with the given ID
        print(f"Reminder with ID {reminder_id} not found for deletion.", file=sys.stderr)
        return jsonify({"message": "Reminder not found"}), 404

    # --- Logic: Delete associated uploaded audio file ---
    # Check if the deleted reminder had an associated audio file and if it was uploaded
    if reminder_to_delete and reminder_to_delete.get('audio_filename') and reminder_to_delete.get('audio_type') == 'uploaded_audio':
        filename = secure_filename(reminder_to_delete['audio_filename'])
        file_path_uploaded = os.path.join(UPLOAD_FOLDER, filename) # Use UPLOAD_FOLDER constant

        # Check if the file exists in the UPLOAD_FOLDER before attempting deletion
        if os.path.exists(file_path_uploaded) and os.path.isfile(file_path_uploaded):
            try:
                print(f"Attempting to delete associated uploaded audio file: {file_path_uploaded}")
                os.remove(file_path_uploaded)
                print(f"Deleted associated uploaded audio file: {file_path_uploaded}")
            except OSError as e:
                print(f"Error deleting associated uploaded audio file {file_path_uploaded}: {e}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
            except Exception as e:
                print(f"Unexpected error deleting associated uploaded audio file {file_path_uploaded}: {e}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
        else:
             print(f"Associated uploaded audio file not found in {UPLOAD_FOLDER} for deletion: {file_path_uploaded}", file=sys.stderr)
    # --- END Logic ---


    # Save the updated list back to the file
    save_reminders(reminders)
    print(f"Deleted reminder with ID: {reminder_id}")
    # Return a success message
    return jsonify({"message": "Reminder deleted"}), 200

# Route to get the current server time
@app.route('/time', methods=['GET'])
def get_server_time():
    print("Received GET request for /time")
    # Get the current time on the server in UTC
    now = datetime.now(timezone.utc)
    # Format the time as an ISO 8601 string
    server_time_str = now.isoformat()
    print(f"Returning server time: {server_time_str}")
    # Return the time as JSON
    return jsonify({"server_time": server_time_str}), 200


# Run the Flask application with SocketIO
if __name__ == '__main__':
    print("Starting Flask app with SocketIO...")
    try:
        # Start the background reminder checker task using SocketIO's method
        # This is better integrated with the async mode (gevent or threading)
        # The task will be started on the first client connection in handle_connect
        print("Reminder checker task will be started on first client connection.")

        # Run the app using socketio.run instead of app.run
        # host='0.0.0.0' makes the server publicly accessible (useful with ngrok)
        # async_mode is set in the SocketIO initialization, debug=True enables reloader and debugger
        print(f"Running SocketIO app on http://0.0.0.0:{5000}")
        socketio.run(app, debug=True, host='0.0.0.0', port=5000) # Explicitly set port
        print("SocketIO app finished running.")
    except Exception as e:
        print(f"Error during Flask app startup: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr) # Print traceback for startup error
        sys.exit(1) # Exit with a non-zero code to indicate failure
