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
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, BorderStyle } = require('docx');
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
    // Użyj folderId z parametrów, jeśli istnieje, w przeciwnym razie użyj domyślnego
    const folderId = req.body.folderId || process.env.GDRIVE_FOLDER_ID;
    console.log(`[DEBUG] Target folder ID: ${folderId} (${req.body.folderId ? 'from request' : 'default'})`);
    diagnosticInfo.folderId = folderId;
    
    if (!folderId) {
      return res.status(500).json({ 
        success: false, 
        error: 'Brak skonfigurowanego ID folderu Google Drive. Ustaw GDRIVE_FOLDER_ID w zmiennych środowiskowych lub podaj folderId w żądaniu.',
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
async function sendFileToFlowiseAI(filePath, flowId, question = "Przeanalizuj ten dokument i zwróć informacje o języku, typie dokumentu i danych osobowych.") {
  try {
    console.log(`[DEBUG] Wysyłanie pliku do analizy FlowiseAI (Flow ID: ${flowId}):`, filePath);
    
    // Przygotuj dane pliku
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    // Konwertuj plik na base64
    const fileBase64 = fileBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${fileBase64}`;
    
    console.log(`[DEBUG] Plik przekonwertowany do base64. Rozmiar: ${fileBase64.length} znaków`);
    console.log(`[DEBUG] Nazwa pliku: ${fileName}, MIME type: ${mimeType}`);
    
    // Przygotowanie prawidłowego formatu JSON dla FlowiseAI
    const requestData = {
      question: question,
      uploads: [
        {
          data: dataUri,
          type: "file",
          name: fileName,
          mime: mimeType
        }
      ]
    };
    
    // URL FlowiseAI API dynamicznie na podstawie flowId
    const apiUrl = `https://cloud.flowiseai.com/api/v1/prediction/${flowId}`;
    
    console.log(`[DEBUG] Wywołanie API FlowiseAI: ${apiUrl}`);
    console.log(`[DEBUG] Format zapytania: ${JSON.stringify({
      question: requestData.question,
      uploads: [{ 
        name: requestData.uploads[0].name,
        mime: requestData.uploads[0].mime,
        type: requestData.uploads[0].type,
        dataLength: requestData.uploads[0].data.length
      }]
    })}`);
    
    // Wysłanie zapytania do API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    console.log(`[DEBUG] Status odpowiedzi: ${response.status} ${response.statusText}`);
    
    // Jeśli odpowiedź nie jest OK, pobierz zawartość błędu
    if (!response.ok) {
      let errorContent = '';
      try {
        errorContent = await response.text();
        console.error('[ERROR] FlowiseAI API error content:', errorContent);
      } catch (textErr) {
        console.error('[ERROR] Nie udało się pobrać treści błędu:', textErr);
      }
      
      throw new Error(`FlowiseAI API error: ${response.status} ${response.statusText}. Content: ${errorContent}`);
    }
    
    // Parsuj odpowiedź JSON
    const result = await response.json();
    console.log('[DEBUG] Otrzymano odpowiedź z FlowiseAI:', JSON.stringify(result).substring(0, 500) + '...');
    
    return result;
  } catch (error) {
    console.error('[ERROR] Błąd podczas analizy dokumentu:', error);
    throw error;
  }
}

// Nowa funkcja do przetwarzania dokumentu przez dwa API FlowiseAI
async function processDocumentWithFlowiseAI(filePath) {
  try {
    console.log('[DEBUG] Rozpoczynam wieloetapową analizę dokumentu');
    
    // ID przepływu dla klasyfikatora dokumentów
    const classifierFlowId = 'bc4f5360-98e2-4ce9-841d-c44812f5d850';
    
    // Krok 1: Najpierw analizujemy typ dokumentu
    console.log('[DEBUG] Krok 1: Klasyfikacja dokumentu');
    const classificationResult = await sendFileToFlowiseAI(
      filePath, 
      classifierFlowId,
      "Przeanalizuj ten dokument i określ jego typ"
    );
    
    console.log('[DEBUG] Wynik klasyfikacji:', JSON.stringify(classificationResult).substring(0, 200));
    
    // Próbujemy sparsować odpowiedź JSON, jeśli jest w formacie tekstowym
    let documentType = 'unknown';
    let resultObj = null;
    
    try {
      // Próbujemy sparsować obiekt JSON z pola text
      if (classificationResult.text) {
        resultObj = JSON.parse(classificationResult.text);
        
        // Sprawdzamy typ dokumentu na podstawie wartości true
        if (resultObj.akt_urodzenia === true) {
          documentType = 'akt_urodzenia';
        } else if (resultObj.akt_malzenstwa === true) {
          documentType = 'akt_malzenstwa';
        } else if (resultObj.akt_zgonu === true) {
          documentType = 'akt_zgonu';
        } else {
          documentType = 'unknown';
        }
      }
    } catch (parseError) {
      console.error('[ERROR] Nie udało się sparsować odpowiedzi JSON:', parseError);
      // Jeśli parsowanie się nie uda, ustawiamy typ dokumentu na unknown
      documentType = 'unknown';
    }
    
    console.log(`[DEBUG] Wykryty typ dokumentu: ${documentType}`);
    
    // Krok 2: Wybór API na podstawie typu dokumentu
    let detailedResult = null;
    
    if (documentType !== 'unknown') {
      // Mapowanie typów dokumentów na ID przepływów 
      const flowIdMap = {
        'akt_urodzenia': '8ea8fdf4-a3d4-4d0a-a6bd-ee91c55ef9df',
        'akt_malzenstwa': 'ID_DO_UZUPEŁNIENIA', // TODO: Uzupełnić prawidłowe ID
        'akt_zgonu': 'ID_DO_UZUPEŁNIENIA'       // TODO: Uzupełnić prawidłowe ID
      };
      
      const detailedFlowId = flowIdMap[documentType];
      
      if (detailedFlowId) {
        console.log(`[DEBUG] Krok 2: Szczegółowa analiza dokumentu typu '${documentType}' używając flow ID: ${detailedFlowId}`);
        
        try {
          detailedResult = await sendFileToFlowiseAI(
            filePath, 
            detailedFlowId,
            `Przeanalizuj szczegółowo ten ${documentType} i wyodrębnij wszystkie dane`
          );
          
          console.log('[DEBUG] Otrzymano szczegółową analizę dokumentu');
        } catch (detailError) {
          console.error('[ERROR] Błąd podczas szczegółowej analizy:', detailError);
          // Jeśli szczegółowa analiza się nie powiedzie, zwróć tylko klasyfikację
        }
      } else {
        console.log(`[WARNING] Brak skonfigurowanego FlowId dla typu dokumentu '${documentType}'`);
      }
    } else {
      console.log('[WARNING] Nie rozpoznano typu dokumentu, pomijam szczegółową analizę');
    }
    
    // Zwróć wyniki z obu API
    return {
      api1Result: classificationResult,
      api2Result: detailedResult,
      documentType: documentType
    };
  } catch (error) {
    console.error('[ERROR] Błąd podczas wieloetapowej analizy dokumentu:', error);
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
      // Wywołanie wieloetapowej analizy
      const analysisResults = await processDocumentWithFlowiseAI(req.file.path);
      
      // Usuń plik tymczasowy
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      // Zwróć wyniki obu API
      res.status(200).json({
        success: true,
        classification: analysisResults.api1Result,
        details: analysisResults.api2Result,
        documentType: analysisResults.documentType,
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

// Funkcja do tworzenia dokumentu DOCX na podstawie danych
async function createDocxTranslation(docData, outputPath) {
  try {
    console.log('[DEBUG] Generowanie dokumentu DOCX z danymi');
    
    // Tablica paragrafów do dodania do dokumentu
    const paragraphs = [];
    
    // Funkcja pomocnicza do tworzenia paragrafów
    const createParagraph = (text, options = {}) => {
      const paragraph = new Paragraph({
        alignment: options.alignment || AlignmentType.LEFT,
        spacing: { before: options.spacingBefore || 0, after: options.spacingAfter || 200 },
        ...options
      });
      
      paragraph.addRun(new TextRun({
        text: text,
        bold: options.bold || false,
        italics: options.italics || false,
        size: options.size || 24,
      }));
      
      return paragraph;
    };
    
    // Dodaj tytuł dokumentu
    paragraphs.push(createParagraph("TŁUMACZENIE UWIERZYTELNIONE Z JĘZYKA UKRAIŃSKIEGO", {
      alignment: AlignmentType.CENTER,
      bold: true,
      size: 28,
      spacingAfter: 400
    }));

    // Dodaj informacje o dokumencie
    paragraphs.push(createParagraph("[Uwagi tłumacza oznaczono kursywą w nawiasie kwadratowym.]", { italics: true }));
    paragraphs.push(createParagraph("[Dokument w postaci jednostronicowego druku urzędowego z godłem państwowym Ukrainy. Pisownia imion i nazwisk zgodna z ukraińską oficjalną transliteracją na litery alfabetu łacińskiego]", 
      { italics: true, spacingAfter: 400 }));

    // Dodaj nagłówek UKRAINA
    paragraphs.push(createParagraph(`UKRAINA ${docData["UKRAINA -/- "] || '-/-'}`, 
      { bold: true, alignment: AlignmentType.CENTER, spacingAfter: 400 }));

    // Dodaj nagłówek AKT URODZENIA
    paragraphs.push(createParagraph("AKT URODZENIA", 
      { bold: true, alignment: AlignmentType.CENTER, spacingAfter: 400 }));

    // Dodaj dane osobowe
    paragraphs.push(createParagraph(`Nazwisko: ${docData["Naziwsko"] || '-/-'}`));
    paragraphs.push(createParagraph(`Imię: ${docData["3. Imie"] || '-/-'}`));
    paragraphs.push(createParagraph(`Imię odojcowskie: ${docData["4. imie ojcowskie"] || '-/-'}`));
    paragraphs.push(createParagraph(`roku (słownie: ) ${docData["5. roku (slownie)"] || '-/-'}`));
    paragraphs.push(createParagraph(`miejsce urodzenia: Ukraina, obwód zaporoski, ${docData["6. miejsce urodzenia: Ukraina, obwód zaporoski,  "] || '-/-'}`));
    paragraphs.push(createParagraph(`o czym w Księdze Rejestracji Urodzeń w dniu roku dokonano odpowiedniego wpisu do akt pod nr ${docData["7. o czym w Księdze Rejestracji Urodzeń w dniu  roku dokonano odpowiedniego wpisu do akt pod nr  "] || '-/-'}`));

    // Dodaj nagłówek RODZICE
    paragraphs.push(createParagraph("RODZICE", 
      { bold: true, alignment: AlignmentType.CENTER, spacingBefore: 400, spacingAfter: 400 }));

    // Dodaj dane rodziców
    paragraphs.push(createParagraph(`Ojciec: , syn ${docData["8. Ojciec: , syn  "] || '-/-'}`));
    paragraphs.push(createParagraph(`Obywatelstwo: ${docData["9. Obywatelstwo"] || '-/-'}`));
    paragraphs.push(createParagraph(`Matka: , córka ${docData["10. Matka: , córka "] || '-/-'}`));
    paragraphs.push(createParagraph(`Obywatelstwo: ${docData["11. Obywatelstwo:  "] || '-/-'}`));

    // Dodaj pozostałe informacje
    paragraphs.push(createParagraph(`Miejsce rejestracji: (nazwa i siedziba państwowego USC) ${docData["12. Miejsce rejestracji: (nazwa i siedziba państwowego USC)  "] || '-/-'}`));
    paragraphs.push(createParagraph(`Organ państwowy wydający akt: (nazwa i siedziba państwowego USC) ${docData["13. Organ państwowy wydający akt: (nazwa i siedziba państwowego USC)  "] || '-/-'}`));
    paragraphs.push(createParagraph(`Data wydania: roku. ${docData["14. Data wydania:  roku. "] || '-/-'}`));
    paragraphs.push(createParagraph(`[Odcisk okrągłej pieczęci z godłem Ukrainy w środku i następującym napisem w otoku:] ${docData["15. [Odcisk okrągłej pieczęci z godłem Ukrainy w środku i następującym napisem w otoku:]"] || '-/-'}`, 
      { italics: true }));
    paragraphs.push(createParagraph(`Kierownik Urzędu Rejestracji Aktów Stanu Cywilnego [podpis skrócony] ${docData["16. Kierownik Urzędu Rejestracji Aktów Stanu Cywilnego [podpis skrócony]  "] || '-/-'}`));
    paragraphs.push(createParagraph(`[Seria i numer dokumentu:] [ - zapis oryginalny] nr ${docData["17. [Seria i numer dokumentu:]  [  - zapis oryginalny] nr  "] || '-/-'}`, 
      { italics: true }));

    // Dodaj linię rozdzielającą
    paragraphs.push(createParagraph("=========================================================================", {
      alignment: AlignmentType.CENTER,
      spacingBefore: 400,
      spacingAfter: 400
    }));

    // Dodaj poświadczenie tłumacza
    paragraphs.push(createParagraph("Ja, Ołena Sawenko, tłumacz przysięgły języka ukraińskiego, wpisany na listę tłumaczy przysięgłych Ministerstwa Sprawiedliwości RP, pod numerem TP/3/16, niniejszym poświadczam zgodność powyższego tłumaczenia z oryginałem dokumentu w języku ukraińskim."));
    paragraphs.push(createParagraph("Numer w repertorium: ."));
    paragraphs.push(createParagraph(`Warszawa, ${new Date().toLocaleDateString('pl-PL')} roku.`, 
      { spacingBefore: 400 }));

    // Utwórz nowy dokument z sekcjami
    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs
      }],
      styles: {
        paragraphStyles: [
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: 28,
              bold: true,
            },
            paragraph: {
              spacing: {
                after: 120,
              },
            },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: 26,
              bold: true,
            },
            paragraph: {
              spacing: {
                before: 240,
                after: 120,
              },
            },
          },
        ],
      },
    });

    // Zapisz dokument
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
    console.log('[DEBUG] Dokument DOCX został wygenerowany i zapisany:', outputPath);
    
    return outputPath;
  } catch (error) {
    console.error('[ERROR] Błąd podczas generowania dokumentu DOCX:', error);
    throw error;
  }
}

// Funkcja do tworzenia i wysyłania dokumentu z danymi
async function createAndFillGoogleDoc(drive, folderName, folderId, documentData) {
  try {
    console.log('[DEBUG] Tworzenie dokumentu DOCX z danymi dla folderu:', folderName);
    
    // Sparsuj dane dokumentu
    let docData = {};
    try {
      if (typeof documentData.details?.text === 'string') {
        docData = JSON.parse(documentData.details.text);
      } else {
        console.log('[WARN] Nie znaleziono danych do wypełnienia dokumentu');
      }
    } catch (parseError) {
      console.error('[ERROR] Nie udało się sparsować danych dokumentu:', parseError);
    }
    
    // Nazwa dokumentu
    const docName = `Tłumaczenie - ${folderName}`;
    const docPath = path.join(__dirname, 'uploads', `${Date.now()}-translation.docx`);
    
    // Generuj plik DOCX
    await createDocxTranslation(docData, docPath);
    
    // Prześlij plik do Google Drive
    console.log('[DEBUG] Przesyłanie wygenerowanego dokumentu DOCX do Google Drive');
    
    // Metadane dla pliku
    const fileMetadata = {
      name: docName,
      parents: [folderId],
      // Ustawiamy flagę, aby Google Drive automatycznie konwertował DOCX na format Google Docs
      mimeType: 'application/vnd.google-apps.document'
    };
    
    // Media z pliku
    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: fs.createReadStream(docPath)
    };
    
    // Prześlij plik do Google Drive
    const uploadResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });
    
    console.log('[INFO] Dokument DOCX przesłany i skonwertowany na Google Docs:', uploadResponse.data.id);
    
    // Usuń tymczasowy plik DOCX
    if (fs.existsSync(docPath)) {
      fs.unlinkSync(docPath);
      console.log('[DEBUG] Usunięto tymczasowy plik DOCX:', docPath);
    }
    
    // Zwróć informacje o dokumencie
    return {
      docId: uploadResponse.data.id,
      docName: uploadResponse.data.name,
      webViewLink: uploadResponse.data.webViewLink
    };
  } catch (error) {
    console.error('[ERROR] Błąd podczas tworzenia/przesyłania dokumentu:', error);
    throw error;
  }
}

// Endpoint do tworzenia dokumentu Google Docs z danymi z analizy
app.post('/create-doc', express.json(), async (req, res) => {
  try {
    // Zmienne dla diagnostyki
    let diagnosticInfo = {
      folderId: null,
      documentData: null,
      driveClientInitialized: false,
      docCreated: false,
      error: null
    };
    
    // Pobranie danych z żądania
    const { folderId, folderName, documentData } = req.body;
    
    if (!folderId || !documentData) {
      return res.status(400).json({ 
        success: false, 
        error: 'Brak wymaganych parametrów. Podaj folderId i documentData.' 
      });
    }
    
    diagnosticInfo.folderId = folderId;
    diagnosticInfo.documentData = 'Data provided (not shown for brevity)';
    
    try {
      // Inicjalizacja klienta Google Drive
      console.log('[DEBUG] Inicjalizacja klienta Google Drive dla tworzenia dokumentu...');
      const drive = initDriveClient();
      diagnosticInfo.driveClientInitialized = true;
      
      // Sprawdź, czy mamy dostęp do folderu
      console.log(`[DEBUG] Sprawdzanie dostępu do folderu: ${folderId}`);
      try {
        const folderInfo = await validateDriveFolder(drive, folderId);
        console.log(`[INFO] Folder zweryfikowany: ${folderInfo.name} (${folderInfo.id})`);
      } catch (folderError) {
        console.error('[ERROR] Błąd weryfikacji folderu:', folderError);
        
        return res.status(500).json({
          success: false,
          error: `Błąd z folderem Google Drive: ${folderError.message}`,
          diagnostic: diagnosticInfo
        });
      }
      
      // Tworzenie i wypełnianie dokumentu
      const docResult = await createAndFillGoogleDoc(
        drive, 
        folderName || 'Dokument_tłumaczenia', 
        folderId, 
        documentData
      );
      
      diagnosticInfo.docCreated = true;
      console.log(`[INFO] Utworzono dokument: ${docResult.docName} (${docResult.docId})`);
      
      // Zwróć sukces i dane dokumentu
      res.status(200).json({
        success: true,
        docId: docResult.docId,
        docName: docResult.docName,
        webViewLink: docResult.webViewLink,
        diagnostic: diagnosticInfo
      });
      
    } catch (error) {
      console.error('[ERROR] Error creating Google Docs document:', error);
      diagnosticInfo.error = error.message;
      
      res.status(500).json({
        success: false,
        error: `Błąd tworzenia dokumentu: ${error.message}`,
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

// Uruchom serwer
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check endpoint: http://localhost:${PORT}/health`);
  console.log(`Upload endpoint: http://localhost:${PORT}/upload`);
  console.log(`FlowiseAI analysis endpoint: http://localhost:${PORT}/flowwise-analyze`);
  console.log(`Create Google Doc endpoint: http://localhost:${PORT}/create-doc`);
});
