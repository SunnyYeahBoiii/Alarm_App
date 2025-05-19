window.onload = function() {
    console.log('Script started after window loaded');

    // Connect to Socket.IO server
    // Since Electron loads directly from the backend URL (e.g., http://127.0.0.1:5000),
    // io() without arguments should connect to the same origin.
    console.log('Attempting to connect to Socket.IO server...');
    const socket = io();


    // Socket.IO event handlers
    socket.on('connect', function() {
        console.log('Socket.IO: Connected to server!');
        // Once connected, fetch initial data and show the main layout
        fetchReminders();
        fetchAndDisplayServerTime(); // Start clock updates
        // displayAudioFiles(); // Audio files are displayed when right sidebar opens

        // Show the main application layout after successful connection
        const mainLayout = document.querySelector('.main-layout');
        if (mainLayout) {
             mainLayout.classList.remove('hidden');
             console.log('Main layout shown.');
             // Show sidebar toggle buttons after main layout is visible
             const openLeftSidebarBtn = document.getElementById('open-left-sidebar-btn');
             const openRightSidebarBtn = document.getElementById('open-right-sidebar-btn');
             const logoutBtn = document.getElementById('logout-btn'); // Assuming logout button exists

             if (openLeftSidebarBtn) openLeftSidebarBtn.classList.remove('hidden');
             if (openRightSidebarBtn) openRightSidebarBtn.classList.remove('hidden');
             // If authentication was fully implemented, show/hide logout based on login status
             // For now, keeping it hidden as auth is minimal
             // if (logoutBtn) logoutBtn.classList.remove('hidden');
        } else {
             console.error('Main layout element not found!');
        }
    });

    socket.on('disconnect', function(reason) {
        console.log('Socket.IO: Disconnected from server. Reason:', reason);
        // Handle disconnection (e.g., show a message, attempt to reconnect)
        showNotification(`Mất kết nối đến máy chủ backend. Lý do: ${reason}. Đang thử kết nối lại...`, 'warning');
    });

    socket.on('connect_error', function(err) {
        console.error('Socket.IO: Connection Error:', err);
        // Display a user-friendly message for connection errors
        showNotification('Không thể kết nối đến máy chủ backend. Vui lòng kiểm tra máy chủ hoặc khởi động lại ứng dụng.', 'error');
    });

     socket.on('error', function(err) {
        console.error('Socket.IO: Generic Error:', err);
         showNotification('Đã xảy ra lỗi Socket.IO.', 'error');
    });


    // Listen for 'reminder_due' event from the server
    socket.on('reminder_due', function(dueReminders) {
        console.log('Socket.IO: Received reminder_due event with data:', dueReminders);
        if (dueReminders && Array.isArray(dueReminders) && dueReminders.length > 0) {
            console.log('Socket.IO: Processing due reminders...');
            let notificationMessage = "Nhắc nhở đến hạn!\n\n";
            dueReminders.forEach((reminder, index) => {
                console.log(`Socket.IO: Processing reminder ${index}:`, reminder);
                notificationMessage += `- ${reminder.text} (${new Date(reminder.time).toLocaleString()})\n`;
            });

            // Display custom popup
            showCustomPopup(notificationMessage);


            // Play sound for the first due reminder received
            // Check for audio_filename and audio_type provided by the backend
            if (dueReminders[0] && dueReminders[0].audio_filename && dueReminders[0].audio_type) {
                 // Construct URL to audio file based on type (backend serves from correct folder)
                 const audioUrl = `/${dueReminders[0].audio_type}/${dueReminders[0].audio_filename}`;
                 console.log('Socket.IO: Playing audio from filename:', dueReminders[0].audio_filename, 'Type:', dueReminders[0].audio_type, 'URL:', audioUrl);
                 playNotificationSound(audioUrl);
            } else {
                 console.log('Socket.IO: Playing default sound (no custom audio specified)');
                 // Play a specific default sound if you have one
                 const defaultAudioUrl = '/default_audio/default_beep.mp3'; // Example default file
                 playNotificationSound(defaultAudioUrl);
            }

            // Refresh the reminder list on the frontend after due reminders are processed
            console.log('Socket.IO: Fetching reminders to update list...');
            fetchReminders();
        } else {
            console.warn('Socket.IO: Received reminder_due event with no or invalid due reminders data:', dueReminders);
        }
    });


    // Get references to main UI elements
    const reminderText = document.getElementById('reminder-text');
    const reminderTime = document.getElementById('reminder-time');
    const addReminderBtn = document.getElementById('add-reminder-btn');
    const digitalClockElement = document.getElementById('digital-clock');
    const overlay = document.querySelector('.overlay');
    const body = document.body;

    // Elements for custom notification popup
    const customNotificationPopup = document.getElementById('custom-notification-popup');
    const popupReminderDetails = document.getElementById('popup-reminder-details');
    const closePopupBtn = document.getElementById('close-popup-btn');

    // Elements for left sidebar (Reminder List)
    const remindersList = document.getElementById('reminders-list');
    const notificationArea = document.getElementById('notification-area'); // Optional notification area
    const leftSidebarPopup = document.querySelector('.sidebar-popup:not(.right-sidebar-popup)'); // Select left sidebar

    // Elements for right sidebar (Audio Management)
    const rightSidebarPopup = document.querySelector('.sidebar-popup.right-sidebar-popup'); // Select right sidebar
    const openLeftSidebarBtn = document.getElementById('open-left-sidebar-btn');
    const openRightSidebarBtn = document.getElementById('open-right-sidebar-btn');
    const uploadAudioInput = document.getElementById('upload-audio-input'); // File input for upload
    const uploadAudioBtn = document.getElementById('upload-audio-btn'); // Upload button
    // Target the container div for audio lists
    const audioListContainer = document.getElementById('audio-list-container');
    const selectedAudioDisplay = document.getElementById('selected-audio-display'); // Element to show selected audio

    // Define the default audio filename and type for identification/selection
    const DEFAULT_AUDIO_FILE_INFO = { filename: 'default_beep.mp3', type: 'default_audio' }; // Example default file info


    // Store reminders locally (backend is the source of truth, this is for display)
    let localReminders = [];
    // Store the filename and type of the selected audio file for adding a new reminder
    let selectedAudio = { filename: null, type: null }; // Initialize as null filename and type


    // Variable to hold the HTML5 Audio object for playing sounds
    let htmlAudioPlayer = null;

    // --- Helper Functions ---

    // Function to show temporary notifications in the notification area
    function showNotification(message, type = 'info') {
        if (!notificationArea) {
            console.warn('Notification area element not found.');
            // Fallback to alert if area is missing
            alert(message);
            return;
        }
        const notificationElement = document.createElement('div');
        notificationElement.classList.add('notification', `notification-${type}`, 'p-3', 'mb-2', 'rounded'); // Add basic classes

        // Add Tailwind classes based on type
        if (type === 'error') {
            notificationElement.classList.add('bg-red-200', 'text-red-800');
        } else if (type === 'warning') {
            notificationElement.classList.add('bg-yellow-200', 'text-yellow-800');
        } else { // info or default
            notificationElement.classList.add('bg-blue-200', 'text-blue-800');
        }

        notificationElement.textContent = message;
        notificationArea.appendChild(notificationElement);

        // Automatically remove the notification after a few seconds
        setTimeout(() => {
            notificationElement.remove();
        }, 5000); // Remove after 5 seconds
    }


    // Function to display the digital clock with provided time from backend
    function displayDigitalClock(timeString) {
        if (digitalClockElement) {
            try {
                // Use the time string from the server to create a Date object
                const now = new Date(timeString);
                // console.log('Clock: Parsed Date object from server time:', now); // Log the parsed Date object

                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');

                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
                const year = now.getFullYear();

                const formattedTimeString = `${hours}:${minutes}:${seconds}`;
                const dateString = `${day}/${month}/${year}`;

                digitalClockElement.innerHTML = `<span class="time">${formattedTimeString}</span><br><span class="date">${dateString}</span>`;
                // console.log('Clock: Digital clock updated with server time:', timeString); // Keep this log less frequent if needed
            } catch (e) {
                 console.error("Error updating digital clock:", e);
                 digitalClockElement.textContent = "Error";
            }

        } else {
            console.error('Clock: Digital clock element not found!');
        }
    }

    // Function to fetch and display server time
    async function fetchAndDisplayServerTime() {
        // console.log('Clock: Attempting to fetch server time...');
        try {
            const response = await fetch('/time');
            // console.log('Clock: Fetch response received:', response);

            if (!response.ok) {
                console.error(`Clock: HTTP error fetching server time! status: ${response.status}`); // Log HTTP error status
                // throw new Error(`HTTP error! status: ${response.status}`); // Don't throw, just log error
                 return; // Stop execution if fetch fails
            }
            const data = await response.json();
            // console.log('Clock: Server time data received:', data);

            if (data && data.server_time) {
                 // console.log('Clock: Server time fetched successfully:', data.server_time);
                 displayDigitalClock(data.server_time); // Display the fetched time
            } else {
                 console.error('Clock: Server time data is missing or invalid in response:', data); // Log if data is missing
                 // Fallback to local time if server time data is missing
                 const now = new Date();
                 displayDigitalClock(now.toISOString()); // Display local time
            }

        } catch (error) {
            console.error('Clock: Error fetching server time:', error);
            // Fallback to local time if server time fetch fails
            const now = new Date();
            displayDigitalClock(now.toISOString()); // Display local time
        }
    }

    // --- Audio File Management Functions ---

    // Function to fetch list of audio files from backend (now returns separated lists)
    async function fetchAudioFiles() {
        console.log('Fetching audio files list from /audio_files...');
        try {
            // Assuming backend has a route /audio_files that returns { available: [], uploaded: [] }
            const response = await fetch('/audio_files');
            if (!response.ok) {
                 console.error(`Error fetching audio files: HTTP error! status: ${response.status}`);
                 // Display message in the correct element (the audio list container)
                 if (audioListContainer) {
                     audioListContainer.innerHTML = '<p class="text-red-500">Không thể tải danh sách tệp âm thanh (backend chưa hỗ trợ hoặc lỗi).</p>';
                 } else {
                     console.error('Audio list container element not found when trying to display error message.');
                 }
                 // Return empty structure on error
                 return { available: [], uploaded: [] };
            }
            const data = await response.json(); // Expecting { available: [], uploaded: [] }
            console.log('Audio files fetched:', data);
            // Ensure the expected structure is present
            if (!data || !Array.isArray(data.available) || !Array.isArray(data.uploaded)) {
                 console.error('Invalid audio files data structure received from backend:', data);
                 // Display message in the correct element
                 if (audioListContainer) {
                      audioListContainer.innerHTML = '<p class="text-red-500">Dữ liệu tệp âm thanh từ backend không hợp lệ.</p>';
                 }
                 return { available: [], uploaded: [] }; // Return empty structure if invalid
            }
            return data;
        } catch (error) {
            console.error('Error fetching audio files list:', error);
            // Display error message in the correct element
             if (audioListContainer) {
                 audioListContainer.innerHTML = '<p class="text-red-500">Lỗi khi tải danh sách tệp âm thanh.</p>';
             } else {
                 console.error('Audio list container element not found when trying to display error message.');
             }
            return { available: [], uploaded: [] }; // Return empty structure on error
        }
    }

    // Function to display audio files in the right sidebar, separated by type
    async function displayAudioFiles() {
        // Corrected: Check if necessary elements exist before proceeding
        if (!audioListContainer) {
            console.error('Required audio list container element not found!');
            return;
        }

        // Clear current content in the audio list container
        audioListContainer.innerHTML = '';

        const filesData = await fetchAudioFiles(); // Fetch files data { available: [], uploaded: [] }
        const availableFiles = filesData.available || []; // Ensure it's an array
        const userFiles = filesData.uploaded || []; // Ensure it's an array

        // Create and add the "Available Sounds" section
        const availableSoundsHeading = document.createElement('h3');
        availableSoundsHeading.classList.add('text-lg', 'font-semibold', 'mb-2', 'available-sounds-heading'); // Add a class for easy removal
        availableSoundsHeading.textContent = 'Âm thanh có sẵn:';

        const availableAudioListElement = document.createElement('ul'); // Create a new UL for available sounds
        availableAudioListElement.classList.add('list-disc', 'list-inside', 'mb-4', 'available-sounds-list'); // Add some styling and a class

        if (availableFiles.length > 0) {
             availableFiles.forEach(filename => {
                 // Add available files to the new UL, mark as default type
                 const fileElement = addAudioOptionElement(filename, 'default_audio'); // Pass filename and type
                 availableAudioListElement.appendChild(fileElement);
             });
        } else {
             const noDefaultMsg = document.createElement('li');
             noDefaultMsg.classList.add('text-gray-500');
             noDefaultMsg.textContent = 'Chưa có tệp âm thanh có sẵn.';
             availableAudioListElement.appendChild(noDefaultMsg);
        }
        // Append the available sounds section to the container
        audioListContainer.appendChild(availableSoundsHeading);
        audioListContainer.appendChild(availableAudioListElement);


        // Create and add the "Uploaded Sounds" section
        const uploadedSoundsHeading = document.createElement('h3');
        uploadedSoundsHeading.classList.add('text-lg', 'font-semibold', 'mb-2', 'mt-4'); // Add margin-top for spacing
        uploadedSoundsHeading.textContent = 'Âm thanh đã tải lên:';

        const uploadedAudioListElement = document.createElement('ul'); // Create a new UL for uploaded sounds
        uploadedAudioListElement.setAttribute('id', 'audio-files-list'); // Give it an ID for potential direct access if needed
        uploadedAudioListElement.classList.add('list-disc', 'list-inside', 'mb-4'); // Add some styling

        if (userFiles.length > 0) {
            userFiles.forEach(filename => {
                // Add user files to the new UL, mark as uploaded type
                const userFileElement = addAudioOptionElement(filename, 'uploaded_audio'); // Pass filename and type
                uploadedAudioListElement.appendChild(userFileElement);
            });
        } else {
            const noUserFilesMsg = document.createElement('li'); // Use li for list item
            noUserFilesMsg.classList.add('text-gray-500');
            noUserFilesMsg.textContent = 'Chưa có tệp âm thanh nào được tải lên.';
            uploadedAudioListElement.appendChild(noUserFilesMsg);
        }
        // Append the uploaded sounds section to the container
        audioListContainer.appendChild(uploadedSoundsHeading);
        audioListContainer.appendChild(uploadedAudioListElement);

         console.log('Audio files displayed, separated into available and uploaded lists.');
    }

    // Helper function to create an audio option list item element
    // Now takes filename and type
    function addAudioOptionElement(filename, type) {
        const fileElement = document.createElement('li'); // Use li for list item
        // Use flexbox to align items and space them out
        fileElement.classList.add('uploaded-audio-item', 'flex', 'justify-between', 'items-center'); // Added flex classes
        if (type === 'default_audio') {
            fileElement.classList.add('default-audio-item'); // Add specific class for default
             // Add inline style to change text color and remove bold for default audio (consistent with previous CSS)
            fileElement.style.color = 'black'; // Keep black text for default
            fileElement.style.fontWeight = 'normal'; // Set font-weight to normal
        } else {
             // Add inline style for uploaded files if needed (e.g., bold)
             fileElement.style.fontWeight = 'bold';
        }

        fileElement.dataset.filename = filename; // Store filename
        fileElement.dataset.type = type; // Store type (folder name, used in URL)

        // Display filename - wrap long filenames and allow text to shrink
        // Added flex-grow to allow the span to take available space
        let displayHtml = `<span style="word-break: break-all;" class="flex-grow mr-2">${filename}</span>`; // Added flex-grow and mr-2

        // Add a play button for all audio options
        displayHtml += `<button class="play-audio-btn mr-2" data-filename="${filename}" data-type="${type}">Phát thử</button>`; // Added play button

        if (type === 'uploaded_audio') {
            // Add delete button only for user-uploaded files
            displayHtml += `<button class="delete-audio-btn" data-filename="${filename}">Xóa</button>`;
        }

        fileElement.innerHTML = displayHtml;
        // Don't append here, the caller will append to the correct UL
        return fileElement;
    }


    // Function to upload an audio file
    async function uploadAudioFile() {
        console.log('Attempting to upload audio file...');
        const file = uploadAudioInput.files[0]; // Get the selected file

        if (!file) {
            showNotification('Vui lòng chọn một tệp âm thanh để tải lên.', 'warning');
            console.warn('No file selected for upload.');
            return;
        }

        const formData = new FormData();
        formData.append('audio_file', file);

        try {
            // Send the file to the backend upload route (assuming this route handles saving to 'uploaded_audio')
            const response = await fetch('/upload_audio', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                console.log('Audio file uploaded successfully');
                const result = await response.json();
                console.log('Backend upload result:', result);
                showNotification('Tệp âm thanh đã được tải lên thành công!', 'info');
                displayAudioFiles(); // Refresh the list after upload
                uploadAudioInput.value = ''; // Clear the file input
            } else {
                const error = await response.json();
                console.error('Error uploading audio file:', error);
                 showNotification(`Lỗi khi tải lên tệp âm thanh: ${error.message || response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('Error uploading audio file:', error);
             showNotification('Đã xảy ra lỗi khi tải lên tệp âm thanh.', 'error');
        }
    }

    // Function to delete an audio file (only from UPLOAD_FOLDER via backend)
    async function deleteAudioFile(filenameToDelete) {
        console.log('Deleting audio file:', filenameToDelete);

        // Prevent deletion of default audio files from frontend (redundant as button is not added, but safe)
        if (filenameToDelete === DEFAULT_AUDIO_FILE_INFO.filename && selectedAudio.type === 'default_audio') {
            showNotification('Không thể xóa tệp âm thanh mặc định.', 'warning');
            console.warn('Attempted to delete default audio file.');
            return;
        }

        if (confirm(`Bạn có chắc chắn muốn xóa tệp âm thanh này không?\n${filenameToDelete}`)) {
             try {
                // Send DELETE request to the backend route for uploaded files
                // Assuming backend route is /uploaded_audio/<filename> for deletion
                const response = await fetch(`/uploaded_audio/${filenameToDelete}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    console.log('Audio file deleted successfully from backend');
                    showNotification('Tệp âm thanh đã xóa thành công!', 'info');
                    displayAudioFiles(); // Refresh the list after deletion
                    // If the deleted file was the selected one, reset the selection
                    if (selectedAudio && selectedAudio.filename === filenameToDelete && selectedAudio.type === 'uploaded_audio') {
                         selectedAudio = { filename: null, type: null };
                         updateSelectedAudioDisplay();
                    }
                } else {
                     const error = await response.json();
                     console.error('Error deleting audio file from backend:', error);
                     showNotification(`Lỗi khi xóa tệp âm thanh (backend): ${error.message || response.statusText}`, 'error');
                     displayAudioFiles(); // Refresh in case of backend error
                }
            } catch (error) {
                console.error('Error deleting audio file from backend:', error);
                showNotification('Đã xảy ra lỗi khi xóa tệp âm thanh.', 'error');
                 displayAudioFiles(); // Refresh in case of network error
            }
        }
    }


    // --- Reminder Functions ---

    // Function to fetch reminders from the backend
    async function fetchReminders() {
        console.log('Fetching reminders...');
        // No user check needed in this non-multiuser version
        try {
            const response = await fetch('/reminders');
            if (!response.ok) {
                console.error(`Error fetching reminders: HTTP error! status: ${response.status}`);
                 showNotification('Không thể tải danh sách nhắc nhở.', 'error');
                 // Don't throw, just log and return empty
                return [];
            }
            const reminders = await response.json();
            console.log('Reminders fetched:', reminders);

            // Update localReminders with backend data
            localReminders = reminders;

            // Sort reminders by time before displaying
            localReminders.sort((a, b) => {
                const timeA = new Date(a.time).getTime();
                const timeB = new Date(b.time).getTime();
                return timeA - timeB; // Sort in ascending order of time
            });
            console.log('Reminders sorted by time:', localReminders);

            displayReminders(localReminders); // Display the fetched and sorted list
            return localReminders; // Return the fetched reminders
        } catch (error) {
            console.error('Error fetching reminders:', error);
             showNotification('Lỗi khi tải danh sách nhắc nhở.', 'error');
            remindersList.innerHTML = '<p class="text-red-500">Không thể tải danh sách nhắc nhở.</p>';
             return []; // Return empty array on error
        }
    }

    // Function to display reminders in the UI
    function displayReminders(reminders) {
        console.log('Displaying reminders:', reminders);
        if (!remindersList) {
             console.error('Reminders list element not found!');
             return;
        }
        remindersList.innerHTML = ''; // Clear current list
        if (!reminders || reminders.length === 0) { // Handle null or empty reminders
            remindersList.innerHTML = '<p class="text-gray-500">Chưa có nhắc nhở nào.</p>';
            return;
        }
        reminders.forEach(reminder => {
            const reminderElement = document.createElement('div');
            reminderElement.classList.add('reminder-item');
            // Format the time for display
            const displayTime = new Date(reminder.time).toLocaleString();

            // Build the HTML for the reminder item as a list
            let reminderHtml = `
                <ul>
                    <li><strong>Lời nhắc:</strong> ${reminder.text}</li>
                    <li><strong>Thời gian:</strong> ${displayTime}</li>
            `;

            // Add audio information if available
            if (reminder.audio_filename && reminder.audio_type) {
                 const audioTypeText = reminder.audio_type === 'default_audio' ? 'Có sẵn' : 'Tải lên';
                 reminderHtml += `<li><strong>Âm thanh:</strong> ${reminder.audio_filename} [${audioTypeText}]</li>`;
            } else {
                 reminderHtml += `<li><strong>Âm thanh:</strong> Mặc định</li>`;
            }

            reminderHtml += `</ul>`; // Close the list

            // Add the delete button
            reminderHtml += `<button class="btn-delete" data-id="${reminder.id}">Xóa</button>`;


            reminderElement.innerHTML = reminderHtml;
            remindersList.appendChild(reminderElement);
        });
    }

    // Function to add a new reminder
    async function addReminder() {
        console.log('Adding reminder...');
        // No user check needed in this non-multiuser version

        const text = reminderText.value.trim();
        const time = reminderTime.value; // datetime-local input gives YYYY-MM-DDTHH:MM format
        // Get the selected audio filename and type from the variable
        const audioFilename = selectedAudio.filename;
        const audioType = selectedAudio.type;


        if (!text || !time) {
            showNotification('Vui lòng nhập nội dung và thời gian nhắc nhắc nhở.', 'warning');
            console.warn('Attempted to add empty reminder');
            return;
        }

        // Convert local datetime string to ISOString with timezone
        // If the input type is datetime-local, the browser doesn't include timezone info.
        // We need to decide how to handle timezones. Assuming local time input for simplicity,
        // but storing as ISO string in UTC is best practice.
        // For this app, let's assume the time entered is in the user's local time,
        // and we convert it to UTC for storage.
        let timeAsDate = new Date(time);
         if (isNaN(timeAsDate.getTime())) {
             showNotification('Định dạng thời gian không hợp lệ.', 'error');
             console.error('Invalid date/time format:', time);
             return;
         }
        const timeISOString = timeAsDate.toISOString();
         console.log(`Input time "${time}" converted to ISO: "${timeISOString}"`);


        // Prepare data to send as JSON
        const reminderData = {
            text: text,
            time: timeISOString, // Send time in ISO format (UTC)
            audio_filename: audioFilename, // Include the selected audio filename (can be null)
            audio_type: audioType // Include the selected audio type (can be null)
        };
         console.log('Reminder data to send:', reminderData);


        try {
            // Send the new reminder data to the backend API using POST
            const response = await fetch('/reminders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json' // Specify content type as JSON
                },
                body: JSON.stringify(reminderData) // Send data as JSON string
            });

            if (response.ok) {
                console.log('Reminder added successfully (backend)');
                const addedReminder = await response.json();
                console.log('Backend returned:', addedReminder);

                showNotification('Đã thêm nhắc nhở thành công!', 'info');
                fetchReminders(); // Refresh the list after successful add

            } else {
                // Handle errors from the backend
                const error = await response.json();
                console.error('Error adding reminder (backend):', error);
                showNotification(`Lỗi khi thêm nhắc nhở: ${error.message || response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('Error adding reminder:', error);
             showNotification('Đã xảy ra lỗi khi thêm nhắc nhở.', 'error');
        } finally {
            // Clear input fields and reset selected audio display
            reminderText.value = '';
            reminderTime.value = '';
            selectedAudio = { filename: null, type: null }; // Reset selected audio
            updateSelectedAudioDisplay(); // Update the display
        }
    }

    // Function to delete a reminder by ID
    async function deleteReminder(id) {
        console.log('Deleting reminder with ID:', id);

        // No user check needed in this non-multiuser version

        if (confirm('Bạn có chắc chắn muốn xóa nhắc nhở này không?')) {
             // Remove from local list first for immediate UI update
             localReminders = localReminders.filter(rem => rem.id !== id);
             displayReminders(localReminders);
             console.log('Removed from local list');

            try {
                // Send DELETE request to the backend API
                const response = await fetch(`/reminders/${id}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    console.log('Reminder deleted from backend successfully');
                    showNotification('Đã xóa nhắc nhở.', 'info');
                    // Backend deleting the associated file is handled on the server side now.
                    // fetchReminders(); // No longer strictly needed as SocketIO will trigger fetchReminders
                } else {
                     // Handle errors from the backend
                     const error = await response.json();
                     console.error('Error deleting reminder from backend:', error);
                     showNotification(`Lỗi khi xóa nhắc nhở (backend): ${error.message || response.statusText}`, 'error');
                     // Fetch again in case of backend error to sync the list
                     fetchReminders();
                }
            } catch (error) {
                console.error('Error deleting reminder from backend:', error);
                showNotification('Đã xảy ra lỗi khi xóa nhắc nhở.', 'error');
                // Fetch again in case of network error to sync the list
                 fetchReminders();
            }
        }
    }

    // Function to play notification sound using HTML5 Audio
    // This function now expects a URL like /default_audio/file.mp3 or /uploaded_audio/unique_file.mp3
    function playNotificationSound(audioUrl) {
        console.log('playNotificationSound called with URL:', audioUrl); // Added log
        try {
            // Stop any currently playing sound
            if (htmlAudioPlayer) {
                console.log('Stopping existing audio player.'); // Added log
                htmlAudioPlayer.pause();
                htmlAudioPlayer.currentTime = 0; // Reset playback position
                htmlAudioPlayer = null; // Clear the reference
            }

            if (audioUrl) {
                console.log('Attempting to create new Audio object for URL:', audioUrl); // Added log
                htmlAudioPlayer = new Audio(audioUrl);
                console.log('Attempting to play audio.'); // Added log
                // Use .play() with a catch to handle potential errors (e.g., user gesture required)
                htmlAudioPlayer.play().then(() => {
                    console.log('Audio playback started successfully.'); // Added success log
                }).catch(error => {
                    console.error('Error playing audio:', error);
                    // Inform the user if playback failed, especially if user gesture is required
                    showNotification(`Lỗi khi phát âm thanh: ${audioUrl}. Vui lòng tương tác với ứng dụng (nhấp chuột) để cho phép phát âm thanh.`, 'warning');
                     console.warn('Audio playback failed. User interaction might be required.');
                });
            } else {
                console.log('No audio URL provided.'); // Added log
                // This case might be for default behavior handled elsewhere or if no sound is desired.
            }

        } catch (audioError) {
             console.error('Error setting up audio playback (HTML5 Audio):', audioError);
             showNotification(`Đã xảy ra lỗi khi thiết lập âm thanh: ${audioError.message}`, 'error');
        }
    }

    // Function to show the custom notification popup
    function showCustomPopup(message) {
        console.log('showCustomPopup called.'); // Log when function is called
         console.log('Popup elements check:', {
            customNotificationPopup: !!customNotificationPopup,
            popupReminderDetails: !!popupReminderDetails,
            body: !!body,
            overlay: !!overlay
        }); // Log if elements are found

        if (customNotificationPopup && popupReminderDetails && body && overlay) {
            popupReminderDetails.textContent = message; // Set the message content
            customNotificationPopup.classList.add('visible'); // Make the popup visible
            body.classList.add('popup-open'); // Add class to body to potentially disable scrolling
            overlay.classList.add('visible'); // Show the overlay
            console.log('Custom notification popup shown.'); // Log on success

            // --- Add detailed logging after adding classes ---
            console.log('Custom popup computed style after adding classes:', {
                display: getComputedStyle(customNotificationPopup).display,
                visibility: getComputedStyle(customNotificationPopup).visibility,
                opacity: getComputedStyle(customNotificationPopup).opacity,
                zIndex: getComputedStyle(customNotificationPopup).zIndex,
                position: getComputedStyle(customNotificationPopup).position,
                top: getComputedStyle(customNotificationPopup).top,
                left: getComputedStyle(customNotificationPopup).left,
                transform: getComputedStyle(customNotificationPopup).transform
            });
             console.log('Overlay computed style after adding classes:', {
                display: getComputedStyle(overlay).display,
                visibility: getComputedStyle(overlay).visibility,
                opacity: getComputedStyle(overlay).opacity,
                zIndex: getComputedStyle(overlay).zIndex,
                position: getComputedStyle(overlay).position
            });
             console.log('Body computed style after adding classes:', {
                overflow: getComputedStyle(body).overflow,
                classList: body.classList.value
            });
            // --- End of detailed logging ---

        } else {
            console.error('Failed to show custom popup: elements not found.');
            // Fallback to alert if popup elements are missing
            alert(message);
        }
    }

    // Function to hide the custom notification popup
    function hideCustomPopup() {
        console.log('hideCustomPopup called.'); // Log when function is called
         console.log('Popup elements check:', {
            customNotificationPopup: !!customNotificationPopup,
            body: !!body,
            overlay: !!overlay
        }); // Log if elements are found

        if (customNotificationPopup && body && overlay) {
            customNotificationPopup.classList.remove('visible'); // Hide the popup
            body.classList.remove('popup-open'); // Remove body class
            overlay.classList.remove('visible'); // Hide the overlay
            console.log('Custom notification popup hidden.'); // Log on success
             // Stop the sound when the popup is closed
            if (htmlAudioPlayer) {
                htmlAudioPlayer.pause();
                htmlAudioPlayer.currentTime = 0; // Reset playback position
            }
        } else {
             console.error('Failed to hide custom popup: elements not found.');
        }
    }

    // Function to update the display showing the selected audio file
    function updateSelectedAudioDisplay() {
        if (selectedAudioDisplay) {
            if (selectedAudio.filename) {
                const audioTypeText = selectedAudio.type === 'default_audio' ? 'Có sẵn' : 'Tải lên';
                selectedAudioDisplay.textContent = `Âm thanh đã chọn: ${selectedAudio.filename} [${audioTypeText}]`;
            } else {
                selectedAudioDisplay.textContent = 'Âm thanh đã chọn: Chưa chọn';
            }
        } else {
            console.error('Selected audio display element not found!');
        }
    }


    // Function to open the left sidebar
    function openLeftSidebar() {
        console.log('Opening left sidebar');
        if (leftSidebarPopup && body && overlay) { // Also check overlay for safety
             leftSidebarPopup.classList.add('open');
             body.classList.add('left-sidebar-open');
             overlay.classList.add('visible'); // Ensure overlay is visible
             // Close right sidebar if open
             if (body.classList.contains('right-sidebar-open')) {
                 closeRightSidebar();
             }
        } else {
             console.error('Left sidebar or body/overlay element not found for opening');
        }
    }

    // Function to close the left sidebar
    function closeLeftSidebar() {
         console.log('Closing left sidebar');
         if (leftSidebarPopup && body && overlay) { // Also check overlay
            leftSidebarPopup.classList.remove('open');
            body.classList.remove('left-sidebar-open');
            // Hide overlay only if NO other sidebar OR popup is open
            if (!body.classList.contains('right-sidebar-open') && !body.classList.contains('popup-open')) {
                overlay.classList.remove('visible');
            }
         } else {
            console.error('Left sidebar or body/overlay element not found for closing');
         }
    }

     // Function to open the right sidebar
    function openRightSidebar() {
        console.log('Opening right sidebar');
        if (rightSidebarPopup && body && overlay) { // Also check overlay
             // Add a small timeout to ensure transition is applied
             setTimeout(() => {
                rightSidebarPopup.classList.add('open');
                console.log('Added open class to right sidebar');
             }, 10); // 10ms delay

             body.classList.add('right-sidebar-open');
             overlay.classList.add('visible'); // Ensure overlay is visible
             displayAudioFiles(); // Display the list of uploaded files when opening
             // Close left sidebar if open
             if (body.classList.contains('left-sidebar-open')) {
                 closeLeftSidebar();
             }

        } else {
             console.error('Right sidebar or body/overlay element not found for opening');
        }
    }

    function closeRightSidebar() {
         console.log('Closing right sidebar');
         if (rightSidebarPopup && body && overlay) { // Also check overlay
            rightSidebarPopup.classList.remove('open');
            body.classList.remove('right-sidebar-open');
            // Hide overlay only if NO other sidebar OR popup is open
             if (!body.classList.contains('left-sidebar-open') && !body.classList.contains('popup-open')) {
                overlay.classList.remove('visible');
            }
         } else {
            console.error('Right sidebar or body/overlay element not found for closing');
         }
    }


    // --- Event Listeners ---

    // Event listener for adding a reminder
    if (addReminderBtn) {
        addReminderBtn.addEventListener('click', addReminder);
         console.log('Add reminder button listener attached');
    } else {
        console.error('Add reminder button not found!');
    }

    // Event listener for deleting a reminder (using event delegation on remindersList)
    if (remindersList) {
        remindersList.addEventListener('click', (event) => {
            if (event.target.classList.contains('btn-delete')) {
                const reminderId = event.target.dataset.id;
                deleteReminder(reminderId); // Call delete function directly
            }
        });
         console.log('Reminders list delete listener attached');
    } else {
         console.error('Reminders list element not found for delete listener!');
    }

    // Event listeners for audio file management in the right sidebar
    if (uploadAudioBtn) {
        uploadAudioBtn.addEventListener('click', uploadAudioFile);
        console.log('Upload audio button listener attached.');
    } else {
        console.error('Upload audio button not found!');
    }

    // Event delegation for clicking on an audio option in the right sidebar
    if (audioListContainer) { // Listener on the container div
        audioListContainer.addEventListener('click', (event) => {
            const target = event.target.closest('.uploaded-audio-item'); // Find the closest list item

            if (target) { // Check if a list item was clicked
                const selectedFilename = target.dataset.filename;
                const selectedType = target.dataset.type; // Get the type

                if (event.target.classList.contains('delete-audio-btn')) {
                    // Handle delete button click
                    // The delete button is only added to uploaded files, so type is implicitly 'uploaded_audio'
                    deleteAudioFile(selectedFilename); // Call delete function

                } else if (event.target.classList.contains('play-audio-btn')) {
                     // Handle play button click
                     const audioUrl = `/${selectedType}/${selectedFilename}`;
                     console.log('Play button clicked, attempting to play:', audioUrl);
                     playNotificationSound(audioUrl);

                } else {
                    // Handle selection click (if not clicking a button)
                    selectedAudio = { filename: selectedFilename, type: selectedType };
                    console.log('Selected audio file for next reminder:', selectedAudio);
                    updateSelectedAudioDisplay(); // Update the display
                    showNotification(`Đã chọn tệp âm thanh:\n${selectedFilename} [${selectedType === 'default_audio' ? 'Có sẵn' : 'Tải lên'}]\nTệp này sẽ được sử dụng cho nhắc nhắc nhở tiếp theo bạn thêm.`, 'info');
                    closeRightSidebar(); // Close the sidebar after selection
                }
            }
        });
        console.log('Audio list container listeners attached.');
    } else {
        console.error('Audio list container element not found!');
    }


    // Event listeners for sidebar toggle buttons
    if (openLeftSidebarBtn) {
        openLeftSidebarBtn.addEventListener('click', openLeftSidebar);
         console.log('Open left sidebar button listener attached');
    } else {
        console.error('Open left sidebar button not found!');
    }

     if (openRightSidebarBtn) {
        openRightSidebarBtn.addEventListener('click', openRightSidebar);
         console.log('Open right sidebar button listener attached');
    } else {
        console.error('Open right sidebar button not found!');
    }

    // Event listener for overlay click to close sidebars/popup
    if (overlay) {
        overlay.addEventListener('click', () => {
            console.log('Overlay clicked. Closing sidebars/popup.');
            // Close both sidebars if open
            if (body.classList.contains('left-sidebar-open')) {
                closeLeftSidebar();
            }
             // Close right sidebar if open
            if (body.classList.contains('right-sidebar-open')) {
                closeRightSidebar();
            }
             // Close popup if open
            if (body.classList.contains('popup-open')) {
                hideCustomPopup();
            }
        });
         console.log('Overlay listener attached');
    } else {
         console.error('Overlay element not found!');
    }

    // Event listener for closing the custom popup
    if (closePopupBtn) {
        closePopupBtn.addEventListener('click', hideCustomPopup);
        console.log('Close popup button listener attached.');
    } else {
        console.error('Close popup button not found!');
    }


    // --- Initial Setup ---
    // These functions are now called on socket.on('connect')
    // fetchReminders();
    // fetchAndDisplayServerTime();

    // Start clock updates only after connecting
    // setInterval(fetchAndDisplayServerTime, 1000); // This interval is started in socket.on('connect')

    console.log('Script finished setting up listeners and intervals.');
    updateSelectedAudioDisplay(); // Initial display for selected audio


    // Add event listener to the document to resume audio context on user interaction
    // This is important for mobile browsers and some desktop browsers requiring gesture for audio playback
    // It's good practice to have this listener
    document.addEventListener('click', function() {
        // Check if there's an audio player instance and if it's paused (meaning playback failed initially)
        if (htmlAudioPlayer && htmlAudioPlayer.paused) {
            console.log('User interacted, attempting to resume audio context...');
            htmlAudioPlayer.play().catch(e => console.error('Error resuming audio context on click:', e));
        }
         // Also ensure the main audio context is resumed if using libraries that require it (like Tone.js)
         // if (Tone.context.state !== 'running') { Tone.context.resume(); } // If using Tone.js
    }, { once: true }); // Use { once: true } to remove the listener after the first click


    // Handle initial state: hide auth section and show main layout if not using auth
    // In this version, auth is removed, so main layout should be shown once backend is connected
    // The logic to show main-layout is moved to socket.on('connect')

}; // End of window.onload

    // Get references to main UI elements
    // ... other element references ...
    const digitalClockElement = document.getElementById('digital-clock');
    // ... other element references ...

    // ... other functions like showNotification, showCustomPopup, hideCustomPopup, etc. ...


    // Function to display the digital clock with provided time from backend
    function displayDigitalClock(timeString) {
        if (digitalClockElement) {
            try {
                // Use the time string from the server to create a Date object
                const now = new Date(timeString);
                console.log('Clock: Parsed Date object from server time:', now); // Log the parsed Date object

                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');

                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
                const year = now.getFullYear();

                const formattedTimeString = `${hours}:${minutes}:${seconds}`;
                const dateString = `${day}/${month}/${year}`;

                digitalClockElement.innerHTML = `<span class="time">${formattedTimeString}</span><br><span class="date">${dateString}</span>`;
                console.log('Clock: Digital clock updated with server time:', timeString); // Keep this log less frequent if needed
            } catch (e) {
                 console.error("Error updating digital clock:", e);
                 digitalClockElement.textContent = "Error";
            }

        } else {
            console.error('Clock: Digital clock element not found!');
        }
    }

    // Function to fetch and display server time
    async function fetchAndDisplayServerTime() {
         console.log('Clock: Attempting to fetch server time...');
        try {
            const response = await fetch('/time');
             console.log('Clock: Fetch response received:', response);

            if (!response.ok) {
                console.error(`Clock: HTTP error fetching server time! status: ${response.status}`); // Log HTTP error status
                // Don't throw here, just log error and potentially fallback
                 // Fallback to local time if server time fetch fails or status is not ok
                 const now = new Date();
                 displayDigitalClock(now.toISOString()); // Display local time as fallback
                 return; // Stop execution if fetch fails
            }
            const data = await response.json();
             console.log('Clock: Server time data received:', data);

            if (data && data.server_time) {
                 console.log('Clock: Server time fetched successfully:', data.server_time);
                 displayDigitalClock(data.server_time); // Display the fetched time
            } else {
                 console.error('Clock: Server time data is missing or invalid in response:', data); // Log if data is missing
                 // Fallback to local time if server time data is missing
                 const now = new Date();
                 displayDigitalClock(now.toISOString()); // Display local time
            }

        } catch (error) {
            console.error('Clock: Error fetching server time:', error);
            // Fallback to local time if server time fetch fails
            const now = new Date();
            displayDigitalClock(now.toISOString()); // Display local time
        }
    }

    // --- Initial Setup (inside window.onload) ---
    // ... other initial setup ...

    // Fetch and display server time immediately and then every second
    fetchAndDisplayServerTime(); // Initial call
    setInterval(fetchAndDisplayServerTime, 1000); // Update every 1000 milliseconds (1 second)

    // ... rest of the window.onload function ...

