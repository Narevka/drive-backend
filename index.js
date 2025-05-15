require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const FormData = require('form-data');
const mime = require('mime-types');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

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

// Funkcja do inicjalizacji Google Drive API z rozszerzonym debugowaniem
const initDriveClient = () => {
  let serviceAccountAuth;
  console.log('[DEBUG] Inicjalizacja klienta Google Drive...');
  
  // Sprawdź wszystkie ścieżki konfiguracyjne
  console.log('[DEBUG] Sprawdzanie konfiguracji...');
  console.log(`[DEBUG] GOOGLE_SERVICE_ACCOUNT_JSON ustawiony: ${!!process.env.GOOGLE_SERVICE_ACCOUNT_JSON}`);
  console.log(`[DEBUG] GOOGLE_SERVICE_ACCOUNT_PATH ustawiony: ${!!process.env.GOOGLE_SERVICE_ACCOUNT_PATH}`);
  console.log(`[DEBUG] GDRIVE_FOLDER_ID ustawiony: ${!!process.env.GDRIVE_FOLDER_ID}`);
  
  // Sprawdź, czy mamy pełny JSON w zmiennej środowiskowej
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('[DEBUG] Próba użycia GOOGLE_SERVICE_ACCOUNT_JSON ze zmiennych środowiskowych');
    try {
      // Jeśli mamy JSON jako string w env, sparsuj go
      let jsonString = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      
      // Sprawdź, czy JSON jest prawidłowym stringiem
      if (typeof jsonString !== 'string') {
        console.error('[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON nie jest stringiem:', typeof jsonString);
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON musi być stringiem JSON');
      }
      
      // Usuń ewentualne znaki ucieczki, które mogły zostać dodane przez system
      if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
        console.log('[DEBUG] Usuwanie dodatkowych znaków cudzysłowu...');
        jsonString = jsonString.slice(1, -1);
      }
      
      // Spróbuj sparsować JSON
      let credentials;
      try {
        credentials = JSON.parse(jsonString);
        console.log('[DEBUG] JSON został pomyślnie sparsowany');
        console.log('[DEBUG] Znalezione pola JSON:', Object.keys(credentials).join(', '));
      } catch (parseError) {
        console.error('[ERROR] Błąd parsowania JSON:', parseError);
        // Wyświetl pierwsze 100 znaków JSON, aby zobaczyć problem
        console.error('[ERROR] Początek JSON:', jsonString.substring(0, 100));
        throw new Error('Błąd parsowania JSON konta usługi: ' + parseError.message);
      }
      
      // Sprawdź wymagane pola
      if (!credentials.client_email || !credentials.private_key) {
        console.error('[ERROR] Brak wymaganych pól w JSON konta usługi');
        throw new Error('Brak wymaganych pól w JSON konta usługi (client_email, private_key)');
      }

      // Inicjalizuj klienta
      console.log('[DEBUG] Inicjalizacja klienta z credentials w zmiennej środowiskowej...');
      serviceAccountAuth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
      console.log('[DEBUG] Klient zainicjalizowany pomyślnie z credentials');
    } catch (error) {
      console.error('[ERROR] Błąd podczas inicjalizacji z GOOGLE_SERVICE_ACCOUNT_JSON:', error);
      throw new Error(`Nieprawidłowy JSON konta usługi w zmiennej środowiskowej: ${error.message}`);
    }
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    // Alternatywnie, użyj ścieżki do pliku JSON
    console.log('[DEBUG] Próba użycia pliku z GOOGLE_SERVICE_ACCOUNT_PATH:', process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
    try {
      const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
      if (!fs.existsSync(filePath)) {
        console.error(`[ERROR] Plik ${filePath} nie istnieje`);
        throw new Error(`Plik konta usługi nie istnieje: ${filePath}`);
      }
      
      console.log('[DEBUG] Plik znaleziony, inicjalizacja klienta...');
      serviceAccountAuth = new google.auth.GoogleAuth({
        keyFile: filePath,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });
      console.log('[DEBUG] Klient zainicjalizowany pomyślnie z pliku');
    } catch (error) {
      console.error('[ERROR] Błąd podczas inicjalizacji z pliku:', error);
      throw new Error(`Błąd inicjalizacji z pliku konta usługi: ${error.message}`);
    }
  } else {
    // Domyślnie szukaj pliku w katalogu projektu
    const keyFilePath = path.join(__dirname, 'service-account.json');
    console.log('[DEBUG] Sprawdzanie domyślnej ścieżki pliku:', keyFilePath);
    
    if (fs.existsSync(keyFilePath)) {
      console.log('[DEBUG] Znaleziono plik w domyślnej lokalizacji');
      try {
        serviceAccountAuth = new google.auth.GoogleAuth({
          keyFile: keyFilePath,
          scopes: ['https://www.googleapis.com/auth/drive.file']
        });
        console.log('[DEBUG] Klient zainicjalizowany pomyślnie z pliku domyślnego');
      } catch (error) {
        console.error('[ERROR] Błąd podczas inicjalizacji z domyślnego pliku:', error);
        throw new Error(`Błąd inicjalizacji z domyślnego pliku konta usługi: ${error.message}`);
      }
    } else {
      console.error('[ERROR] Nie znaleziono żadnego sposobu autoryzacji');
      throw new Error('Nie znaleziono poświadczeń konta usługi. Ustaw GOOGLE_SERVICE_ACCOUNT_JSON lub GOOGLE_SERVICE_ACCOUNT_PATH, albo umieść service-account.json w katalogu projektu.');
    }
  }

  const drive = google.drive({ version: 'v3', auth: serviceAccountAuth });
  console.log('[DEBUG] Klient Google Drive zainicjalizowany poprawnie');
  return drive;
};

// Endpoint zdrowia dla monitoringu
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint do tworzenia folderu w Google Drive
app.post('/create-folder', express.json(), async (req, res) => {
  try {
    // Zmienne dla diagnostyki
    let diagnosticInfo = {
      folderName: null,
      parentFolderId: null,
      driveClientInitialized: false,
      folderCreated: false,
      error: null
    };
    
    // Sprawdź, czy podano nazwę folderu
    const { folderName, parentFolderId } = req.body;
    
    if (!folderName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Brak nazwy folderu. Podaj parametr folderName w ciele żądania.' 
      });
    }
    
    diagnosticInfo.folderName = folderName;
    
    // Użyj domyślnego folderu głównego jeśli nie podano parent_id
    const targetParentId = parentFolderId || process.env.GDRIVE_FOLDER_ID;
    diagnosticInfo.parentFolderId = targetParentId;
    
    if (!targetParentId) {
      return res.status(500).json({ 
        success: false, 
        error: 'Brak skonfigurowanego ID folderu Google Drive. Ustaw GDRIVE_FOLDER_ID w zmiennych środowiskowych lub podaj parentFolderId w żądaniu.',
        diagnostic: diagnosticInfo
      });
    }

    try {
      // Inicjalizacja klienta Google Drive
      console.log('[DEBUG] Inicjalizacja klienta Google Drive dla tworzenia folderu...');
      const drive = initDriveClient();
      diagnosticInfo.driveClientInitialized = true;
      
      // Sprawdź, czy mamy dostęp do folderu nadrzędnego (jeśli podano)
      if (parentFolderId) {
        console.log(`[DEBUG] Sprawdzanie dostępu do folderu nadrzędnego: ${parentFolderId}`);
        try {
          const folderInfo = await validateDriveFolder(drive, parentFolderId);
          console.log(`[INFO] Folder nadrzędny zweryfikowany: ${folderInfo.name} (${folderInfo.id})`);
        } catch (folderError) {
          console.error('[ERROR] Błąd weryfikacji folderu nadrzędnego:', folderError);
          diagnosticInfo.error = folderError.message;
          
          return res.status(500).json({
            success: false,
            error: `Błąd z folderem nadrzędnym Google Drive: ${folderError.message}`,
            diagnostic: diagnosticInfo
          });
        }
      }
      
      // Utwórz folder
      console.log(`[DEBUG] Tworzenie folderu "${folderName}" w folderze o ID: ${targetParentId}`);
      
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [targetParentId],
      };
      
      const result = await drive.files.create({
        resource: folderMetadata,
        fields: 'id, name, webViewLink',
      });
      
      diagnosticInfo.folderCreated = true;
      console.log(`[INFO] Folder utworzony pomyślnie: ${result.data.name} (${result.data.id})`);
      
      // Zwróć sukces i dane folderu
      res.status(200).json({
        success: true,
        folderId: result.data.id,
        folderName: result.data.name,
        webViewLink: result.data.webViewLink,
        parentFolderId: targetParentId,
        diagnostic: diagnosticInfo
      });
      
    } catch (error) {
      console.error('[ERROR] Error during Google Drive folder creation:', error);
      diagnosticInfo.error = error.message;
      
      // Szczegółowa diagnostyka błędu
      let errorDetails = 'Nieznany błąd';
      if (error.code) {
        diagnosticInfo.errorCode = error.code;
      }
      
      if (error.response && error.response.data) {
        console.error('[ERROR] Odpowiedź API:', JSON.stringify(error.response.data));
        diagnosticInfo.apiResponse = error.response.data;
        
        if (error.response.data.error) {
          errorDetails = `${error.response.data.error.message} (${error.response.data.error.code})`;
        }
      }
      
      res.status(500).json({
        success: false,
        error: `Błąd tworzenia folderu w Google Drive: ${error.message}`,
        errorDetails: errorDetails,
        diagnostic: diagnosticInfo
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

// Funkcja do sprawdzania dostępu do folderu Google Drive
const validateDriveFolder = async (drive, folderId) => {
  console.log(`[DEBUG] Sprawdzanie dostępu do folderu: ${folderId}`);
  
  try {
    // Sprawdź, czy mamy dostęp do podanego folderu
    const folderInfo = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType'
    });
    
    console.log(`[DEBUG] Informacje o folderze: ${JSON.stringify(folderInfo.data)}`);
    
    // Sprawdź, czy to jest folder
    if (folderInfo.data.mimeType !== 'application/vnd.google-apps.folder') {
      console.error(`[ERROR] ID ${folderId} nie jest folderem`);
      throw new Error(`ID ${folderId} nie jest folderem. Podaj poprawne ID folderu Google Drive.`);
    }
    
    return folderInfo.data;
  } catch (error) {
    if (error.code === 404) {
      console.error(`[ERROR] Folder o ID ${folderId} nie istnieje lub konto usługi nie ma do niego dostępu`);
      throw new Error(`Folder o ID ${folderId} nie istnieje lub konto usługi nie ma do niego dostępu. Sprawdź ID folderu i uprawnienia.`);
    }
    
    if (error.code === 403) {
      console.error(`[ERROR] Brak uprawnień do folderu o ID ${folderId}`);
      throw new Error(`Brak uprawnień do folderu o ID ${folderId}. Upewnij się, że konto usługi ma uprawnienia do tego folderu.`);
    }
    
    console.error(`[ERROR] Błąd podczas sprawdzania folderu: ${error.message}`);
    throw new Error(`Błąd podczas sprawdzania folderu: ${error.message}`);
  }
};

// Endpoint do uploadu pliku na Google Drive
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Zmienne dla diagnostyki
    let diagnosticInfo = {
      file: null,
      folderId: null,
      driveClientInitialized: false,
      folderVerified: false,
      uploadAttempted: false,
      error: null
    };
    
    // Sprawdź, czy plik został przesłany
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Brak pliku do uploadu' 
      });
    }

    console.log('[INFO] Uploading file:', req.file.originalname);
    diagnosticInfo.file = {
      name: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    };
    
    // ID folderu na Google Drive, do którego chcemy uploadować pliki
    const folderId = process.env.GDRIVE_FOLDER_ID;
    diagnosticInfo.folderId = folderId;
    
    if (!folderId) {
      return res.status(500).json({ 
        success: false, 
        error: 'Brak skonfigurowanego ID folderu Google Drive. Ustaw GDRIVE_FOLDER_ID w zmiennych środowiskowych.',
        diagnostic: diagnosticInfo
      });
    }

    try {
      // Inicjalizacja klienta Google Drive
      console.log('[DEBUG] Inicjalizacja klienta Google Drive...');
      const drive = initDriveClient();
      diagnosticInfo.driveClientInitialized = true;
      
      // Sprawdź, czy mamy dostęp do folderu
      console.log('[DEBUG] Sprawdzanie dostępu do folderu...');
      try {
        const folderInfo = await validateDriveFolder(drive, folderId);
        console.log(`[INFO] Folder zweryfikowany: ${folderInfo.name} (${folderInfo.id})`);
        diagnosticInfo.folderVerified = true;
      } catch (folderError) {
        console.error('[ERROR] Błąd weryfikacji folderu:', folderError);
        diagnosticInfo.error = folderError.message;
        
        // Usuń plik tymczasowy
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        
        return res.status(500).json({
          success: false,
          error: `Błąd z folderem Google Drive: ${folderError.message}`,
          diagnostic: diagnosticInfo
        });
      }
      
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
      console.log('[DEBUG] Rozpoczynam upload pliku do Google Drive...');
      diagnosticInfo.uploadAttempted = true;
      
      const uploadResponse = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink', // Pola, które chcemy otrzymać w odpowiedzi
      });

      console.log('[INFO] File uploaded successfully:', uploadResponse.data.id);

      // Usuń plik tymczasowy
      fs.unlinkSync(req.file.path);

      // Zwróć sukces i dane pliku
      res.status(200).json({
        success: true,
        fileId: uploadResponse.data.id,
        fileName: uploadResponse.data.name,
        webViewLink: uploadResponse.data.webViewLink, // Link do podglądu pliku w Google Drive
        diagnostic: diagnosticInfo
      });
    } catch (error) {
      console.error('[ERROR] Error during Google Drive upload:', error);
      diagnosticInfo.error = error.message;
      
      // Szczegółowa diagnostyka błędu
      let errorDetails = 'Nieznany błąd';
      if (error.code) {
        diagnosticInfo.errorCode = error.code;
      }
      
      if (error.response && error.response.data) {
        console.error('[ERROR] Odpowiedź API:', JSON.stringify(error.response.data));
        diagnosticInfo.apiResponse = error.response.data;
        
        if (error.response.data.error) {
          errorDetails = `${error.response.data.error.message} (${error.response.data.error.code})`;
        }
      }
      
      // Usuń plik tymczasowy nawet w przypadku błędu
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        error: `Błąd uploadu do Google Drive: ${error.message}`,
        errorDetails: errorDetails,
        diagnostic: diagnosticInfo
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

// Funkcja do wysyłania pliku do analizy przez FlowiseAI
async function sendFileToFlowiseAI(filePath) {
  try {
    console.log('[DEBUG] Wysyłanie pliku do analizy FlowiseAI:', filePath);
    
    // Przygotuj dane pliku
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    // Poniżej przykładowy kod do wywołania API FlowiseAI
    // Należy dostosować URL oraz format żądania do rzeczywistego API
    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
    form.append('question', 'Przeanalizuj ten dokument i zwróć informacje o języku, typie dokumentu i danych osobowych.');
    
    const apiUrl = 'https://cloud.flowiseai.com/api/v1/prediction/bc4f5360-98e2-4ce9-841d-c44812f5d850';
    
    console.log(`[DEBUG] Wywołanie API FlowiseAI: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      body: form,
      headers: {
        // FormData automatycznie ustawia odpowiedni Content-Type z boundary
        // Możesz dodać inne nagłówki np. autoryzacyjne jeśli są wymagane
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('[ERROR] FlowiseAI API error:', response.status, error);
      throw new Error(`FlowiseAI API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('[DEBUG] Otrzymano odpowiedź z FlowiseAI:', JSON.stringify(result).substring(0, 200) + '...');
    
    return result;
  } catch (error) {
    console.error('[ERROR] Błąd podczas analizy dokumentu:', error);
    throw error;
  }
}

// Endpoint do analizy dokumentu przez FlowiseAI
app.post('/flowwise-analyze', upload.single('file'), async (req, res) => {
  try {
    // Sprawdź, czy plik został przesłany
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Brak pliku do analizy' 
      });
    }

    console.log('[INFO] Analizowanie pliku:', req.file.originalname);
    
    try {
      // Wywołanie API FlowiseAI
      const apiResponse = await sendFileToFlowiseAI(req.file.path);
      
      // Usuń plik tymczasowy
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      // Zwróć wynik analizy
      res.status(200).json({
        success: true,
        api_response: apiResponse,
        file_info: {
          name: req.file.originalname,
          size: req.file.size,
          type: req.file.mimetype
        }
      });
    } catch (error) {
      console.error('[ERROR] Error during FlowiseAI analysis:', error);
      
      // Usuń plik tymczasowy nawet w przypadku błędu
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        error: `Błąd analizy przez FlowiseAI: ${error.message}`
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

// Uruchom serwer
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check endpoint: http://localhost:${PORT}/health`);
  console.log(`Upload endpoint: http://localhost:${PORT}/upload`);
  console.log(`FlowiseAI analysis endpoint: http://localhost:${PORT}/flowwise-analyze`);
});
