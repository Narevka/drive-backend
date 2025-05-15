require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');

// Konfiguracja aplikacji Express
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // Ogranicz do domeny frontendowej
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(morgan('dev'));
app.use(express.json());

// Skonfigurowanie tymczasowego folderu dla uploadów
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    // Zachowaj oryginalną nazwę pliku, ale dodaj timestamp dla unikalności
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, path.basename(file.originalname, extension) + '-' + uniqueSuffix + extension);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Limit do 10MB (zwiększ jeśli potrzeba)
  }
});

// Funkcja do inicjalizacji Google Drive API
const initDriveClient = () => {
  let serviceAccountAuth;
  
  // Sprawdź, czy mamy pełny JSON w zmiennej środowiskowej
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      // Jeśli mamy JSON jako string w env, sparsuj go
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      serviceAccountAuth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
    } catch (error) {
      console.error('Error parsing service account JSON from env:', error);
      throw new Error('Invalid service account JSON in environment variable');
    }
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    // Alternatywnie, użyj ścieżki do pliku JSON
    serviceAccountAuth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
  } else {
    // Domyślnie szukaj pliku w katalogu projektu
    const keyFilePath = path.join(__dirname, 'service-account.json');
    if (fs.existsSync(keyFilePath)) {
      serviceAccountAuth = new google.auth.GoogleAuth({
        keyFile: keyFilePath,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
    } else {
      throw new Error('Service account credentials not found. Please set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH env variable, or place service-account.json in project root.');
    }
  }

  return google.drive({ version: 'v3', auth: serviceAccountAuth });
};

// Endpoint zdrowia dla monitoringu
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint do uploadu pliku na Google Drive
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Sprawdź, czy plik został przesłany
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Brak pliku do uploadu' });
    }

    console.log('Uploading file:', req.file.originalname);
    
    // ID folderu na Google Drive, do którego chcemy uploadować pliki
    const folderId = process.env.GDRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({ success: false, error: 'Brak skonfigurowanego ID folderu Google Drive. Ustaw GDRIVE_FOLDER_ID w zmiennych środowiskowych.' });
    }

    try {
      // Inicjalizacja klienta Google Drive
      const drive = initDriveClient();

      // Metadane pliku
      const fileMetadata = {
        name: req.file.originalname, // Używamy oryginalnej nazwy pliku
        parents: [folderId], // Umieszczamy plik w określonym folderze
      };

      // Media z pliku
      const media = {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path), // Odczytujemy plik z dysku
      };

      // Wysyłamy plik do Google Drive
      const uploadResponse = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink', // Pola, które chcemy otrzymać w odpowiedzi
      });

      console.log('File uploaded successfully:', uploadResponse.data.id);

      // Usuń plik tymczasowy
      fs.unlinkSync(req.file.path);

      // Zwróć sukces i dane pliku
      res.status(200).json({
        success: true,
        fileId: uploadResponse.data.id,
        fileName: uploadResponse.data.name,
        webViewLink: uploadResponse.data.webViewLink, // Link do podglądu pliku w Google Drive
      });
    } catch (error) {
      console.error('Error during Google Drive upload:', error);
      
      // Usuń plik tymczasowy nawet w przypadku błędu
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        error: `Błąd uploadu do Google Drive: ${error.message}`,
      });
    }
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: `Nieoczekiwany błąd: ${error.message}`,
    });
  }
});

// Obsługa błędów
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Wystąpił błąd serwera',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Spróbuj utworzyć folder uploads, jeśli nie istnieje
try {
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
  }
} catch (err) {
  console.error('Could not create uploads directory:', err);
}

// Uruchom serwer
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check endpoint: http://localhost:${PORT}/health`);
  console.log(`Upload endpoint: http://localhost:${PORT}/upload`);
});
