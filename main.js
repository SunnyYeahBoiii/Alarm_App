const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process'); // Import module để chạy quy trình con
// const fetch = require('node-fetch'); // <--- Dòng này đã được thay thế bằng import() động bên dưới
const fs = require('fs'); // Import fs để kiểm tra sự tồn tại của tệp

let mainWindow;
let backendProcess; // Biến để lưu trữ quy trình backend
const backendPort = 5000; // Cổng mặc định của backend Flask
const backendUrl = `http://127.0.0.1:${backendPort}`; // URL của backend

function createMainWindow() {
    // Kiểm tra xem cửa sổ đã tồn tại chưa trước khi tạo
    if (mainWindow && !mainWindow.isDestroyed()) {
        console.log("Main window already exists.");
        mainWindow.focus(); // Focus existing window
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1000, // Increased default width
        height: 700, // Increased default height
        webPreferences: {
            // preload: path.join(__dirname, 'preload.js'), // Optional: use a preload script
            nodeIntegration: false, // Tắt nodeIntegration vì lý do bảo mật
            contextIsolation: true // Bật contextIsolation
        },
        title: 'Ứng dụng Nhắc nhở', // Set window title
        icon: path.join(__dirname, 'icon.png') // Optional: set an application icon
    });

    // Tải URL của backend (sẽ phục vụ index.html)
    console.log(`Loading frontend from: ${backendUrl}`);
    mainWindow.loadURL(backendUrl);

    // Mở DevTools (Công cụ phát triển) - Rất hữu ích để debug frontend
    // Comment out or remove this line in production builds
    mainWindow.webContents.openDevTools();


    // Handle window close event
    mainWindow.on('closed', function () {
        console.log("Main window closed.");
        mainWindow = null; // Dereference the window object
        // When the main window is closed, quit the entire app, which will trigger 'will-quit'
        app.quit();
    });
}

// Function to start the Flask backend process
function startBackend() {
    // Determine the path to the Python executable and app.py
    // In a packaged app, the Python executable might be bundled or in the system PATH
    // This path might need adjustment based on your packaging setup
    const pythonExecutable = 'python'; // Try 'python3' if 'python' doesn't work
    const backendScript = 'app.py';
    // Use path.join for cross-platform compatibility
    const backendScriptPath = path.join(__dirname, backendScript);

    console.log(`Đang cố gắng khởi động backend: ${pythonExecutable} "${backendScriptPath}"`);

    // Check if the backend script file exists in the expected location
    if (!fs.existsSync(backendScriptPath)) {
        const errorMsg = `Lỗi: Không tìm thấy tệp backend app.py tại "${backendScriptPath}". Vui lòng kiểm tra lại cấu trúc dự án và quá trình build.`;
        console.error(errorMsg); // Log to console
        dialog.showErrorBox(
            'Lỗi khởi động Backend',
            errorMsg
        );
        app.quit();
        return; // Stop the function if file not found
    }


    // Spawn the Python process
    // cwd: Set the current working directory for the child process to the directory containing app.py
    // This is important for app.py to find reminders.json and audio folders.
    backendProcess = spawn(pythonExecutable, [backendScriptPath], { cwd: __dirname });


    // Lắng nghe output từ backend (stdout)
    backendProcess.stdout.on('data', (data) => {
        console.log(`Backend stdout: ${data}`);
        // You can add more sophisticated checks here if needed
    });

    // Lắng nghe output lỗi từ backend (stderr)
    backendProcess.stderr.on('data', (data) => {
        console.error(`Backend stderr: ${data}`);
        const errorOutput = data.toString();
        // Check for specific error messages indicating startup failure
        if (errorOutput.includes('Address already in use') || errorOutput.includes(`Error binding to port ${backendPort}`)) {
             console.error('Backend failed to start: Address already in use.');
             dialog.showErrorBox(
                 'Lỗi khởi động Backend',
                 `Cổng ${backendPort} đang được sử dụng. Vui lòng đóng ứng dụng khác đang sử dụng cổng này và thử lại.`
             );
             app.quit(); // Thoát ứng dụng Electron
        } else if (errorOutput.includes('ModuleNotFoundError')) {
             console.error('Backend failed to start: Module not found.');
             dialog.showErrorBox(
                 'Lỗi phụ thuộc Python',
                 'Không tìm thấy các thư viện Python cần thiết. Vui lòng đảm bảo bạn đã cài đặt tất cả các thư viện trong requirements.txt (Flask, Flask-SocketIO, gevent, etc.) trong môi trường Python mà Electron đang sử dụng.'
             );
             app.quit(); // Thoát ứng dụng Electron
        }
        // Add other specific error checks as needed
    });

    // Lắng nghe sự kiện khi quy trình backend đóng
    backendProcess.on('close', (code) => {
        console.log(`Quy trình backend đã đóng với mã: ${code}`);
        backendProcess = null;
        // Show an error dialog if backend exited unexpectedly and the main window exists
        if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
             dialog.showErrorBox(
                 'Backend đã dừng đột ngột',
                 `Máy chủ backend Flask đã dừng hoạt động với mã lỗi: ${code}. Ứng dụng có thể không hoạt động đúng.`
             );
             // Decide whether to quit the app or let the user try to fix/restart
             // app.quit(); // Uncomment to quit the app when backend crashes
        }
    });

     backendProcess.on('error', (err) => {
        console.error(`Lỗi khi khởi động quy trình backend: ${err}`);
         // Hiển thị thông báo lỗi nếu không thể spawn quy trình (ví dụ: không tìm thấy lệnh 'python')
         dialog.showErrorBox(
             'Lỗi khởi động Backend',
             `Không thể khởi động máy chủ backend Python. Vui lòng đảm bảo lệnh 'python' có sẵn trong PATH và app.py nằm đúng vị trí.\nLỗi: ${err.message}`
         );
         app.quit(); // Thoát ứng dụng Electron
     });

    // Kiểm tra xem backend đã sẵn sàng chưa bằng cách ping endpoint /time
    // Sử dụng async/await và import() động cho fetch
    const checkBackendReady = setInterval(async () => {
        try {
            // Sử dụng import() động cho node-fetch
            const { default: fetch } = await import('node-fetch');
            const response = await fetch(`${backendUrl}/time`);

            if (response.ok) {
                console.log('Backend đã sẵn sàng.');
                clearInterval(checkBackendReady); // Dừng kiểm tra
                // Tạo cửa sổ chính sau khi backend sẵn sàng
                createMainWindow();
            } else {
                // Backend returned non-2xx status, still not ready or error
                console.log('Backend chưa sẵn sàng (status non-ok), đang chờ...');
            }
        } catch (err) {
            // Fetch failed (e.g., connection refused), backend is likely not listening yet
            console.log('Đang chờ backend lắng nghe...', err.message);
        }
    }, 500); // Kiểm tra mỗi 500ms
}


// Electron app lifecycle events
app.whenReady().then(() => {
    // Kiểm tra nếu đang ở môi trường đóng gói (asar)
    const isPackaged = app.isPackaged;
    console.log(`App is packaged: ${isPackaged}`);
    console.log(`App path: ${app.getAppPath()}`);

    // Start the backend process when the app is ready
    startBackend();

    // Xử lý khi ứng dụng được kích hoạt lại (ví dụ: click vào icon trên dock)
    app.on('activate', function () {
        // Trên macOS, thường tạo lại cửa sổ trong ứng dụng khi icon dock được click
        // và không có cửa sổ nào đang mở.
        if (BrowserWindow.getAllWindows().length === 0) {
            // Chỉ tạo lại cửa sổ chính nếu backend đã được khởi động
            if (backendProcess) {
                 // Ping backend before creating window to ensure it's still alive
                 // Use dynamic import for fetch here as well
                 import('node-fetch').then(({ default: fetch }) => {
                     fetch(`${backendUrl}/time`)
                         .then(res => {
                             if (res.ok) {
                                  createMainWindow();
                             } else {
                                  console.warn('Backend not responsive on activate, attempting restart...');
                                  startBackend(); // Try restarting backend
                             }
                         })
                         .catch(err => {
                              console.error('Error checking backend on activate, attempting restart:', err);
                              startBackend(); // Try restarting backend
                         });
                 }).catch(err => {
                     console.error('Error importing node-fetch on activate:', err);
                     // Cannot check backend without fetch, try restarting backend
                     startBackend();
                 });

            } else {
                 // Nếu backend chưa chạy, thử khởi động
                 startBackend();
            }
        }
    });
});

// Thoát khi tất cả các cửa sổ được đóng, trừ trên macOS.
app.on('window-all-closed', function () {
    // Trên macOS, ứng dụng và thanh menu của nó thường vẫn hoạt động
    // cho đến khi người dùng thoát rõ ràng bằng Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Xử lý khi ứng dụng chuẩn bị thoát
app.on('will-quit', () => {
     // Đảm bảo quy trình backend được dừng khi ứng dụng Electron thoát
     if (backendProcess && !backendProcess.killed) {
         console.log('Đang dừng quy trình backend khi Electron thoát...');
         // Gửi tín hiệu SIGINT để backend có thể cleanup
         backendProcess.kill('SIGINT');
         console.log('Quy trình backend đã dừng.');
     }
});

// Optional: Add a preload script if you need to expose Node.js APIs to the renderer process
// Or if you need to perform tasks before the page loads
// require('./preload.js'); // Create this file if needed
