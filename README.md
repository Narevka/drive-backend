# TLM Backend

Backend API do uploadu plików na Google Drive przy użyciu konta usługi (service account) oraz analizy dokumentów z wykorzystaniem sztucznej inteligencji. Służy jako alternatywa dla funkcji Edge, pozwalając na obejście ograniczeń związanych z autoryzacją Google Drive API w środowisku Edge Functions.

## Funkcjonalności

- Upload plików na Google Drive przy użyciu konta usługi
- Automatyczne odświeżanie tokenów bez konieczności autoryzacji użytkownika
- Analiza dokumentów z wykorzystaniem GPT-4o Vision (OpenAI)
- Endpoint `/upload` do przesyłania plików
- Endpoint `/flowwise-analyze` do analizy dokumentów
- Endpoint `/create-folder` do tworzenia folderów na Google Drive
- Endpoint `/create-doc` do tworzenia dokumentów Google Docs
- Endpoint `/health` do monitorowania stanu serwera

## Wymagania

- Node.js 16+
- NPM lub Yarn
- Konto usługi Google Cloud z włączonym Google Drive API
- Udostępniony folder Google Drive dla konta usługi
- Klucz API OpenAI (dla funkcji analizy dokumentów)

## Instalacja i uruchomienie lokalne

1. Sklonuj repozytorium
2. Zainstaluj zależności:
   ```bash
   cd drive-backend
   npm install
   ```
3. Utwórz plik `.env` na podstawie `.env.example` i uzupełnij zmienne środowiskowe:
   ```
   GDRIVE_FOLDER_ID=twoje_id_folderu_drive
   FRONTEND_URL=http://localhost:5173
   PORT=3001
   OPENAI_API_KEY=sk-your_openai_api_key
   ```
4. Umieść plik `service-account.json` z kluczem konta usługi Google w głównym katalogu projektu lub ustaw jego zawartość jako zmienną środowiskową `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Uruchom serwer:
   ```bash
   npm start
   ```
   Serwer będzie dostępny pod adresem: http://localhost:3001

## Wdrożenie na Render.com

1. Utwórz nowe repozytorium na GitHub i push'nij kod
2. Zaloguj się do [Render.com](https://render.com)
3. Kliknij "New" -> "Web Service"
4. Połącz z repozytorium GitHub
5. Wypełnij formularz:
   - **Name**: drive-backend (lub inna nazwa)
   - **Region**: Wybierz najbliższy region
   - **Branch**: main (lub inna gałąź)
   - **Root Directory**: drive-backend (jeśli projekt jest w podkatalogu)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
6. W sekcji "Environment Variables" dodaj wszystkie zmienne z pliku `.env`:
   - `GDRIVE_FOLDER_ID` - ID folderu Google Drive
   - `FRONTEND_URL` - URL Twojego frontendu (np. https://tlmmedium.vercel.app)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` - Cały plik service-account.json jako string
   - `OPENAI_API_KEY` - Klucz API OpenAI (dla analizy dokumentów)

7. Kliknij "Create Web Service"

## Jak pobrać ID folderu Google Drive

ID folderu to ciąg znaków w URL po otwarciu folderu w Google Drive:
```
https://drive.google.com/drive/folders/TWOJE_ID_FOLDERU_TUTAJ
```

## Jak uzyskać plik service-account.json

1. Przejdź do [Google Cloud Console](https://console.cloud.google.com)
2. Wybierz swój projekt
3. Przejdź do "IAM & Admin" -> "Service Accounts"
4. Wybierz lub utwórz konto usługi
5. W sekcji "Keys" kliknij "Add Key" -> "Create New Key"
6. Wybierz format JSON i kliknij "Create"
7. Plik zostanie automatycznie pobrany

## Jak używać w aplikacji frontendowej

### Przykład uploadu pliku na Google Drive

```javascript
const uploadFileToDrive = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('https://twoj-backend-url.onrender.com/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (data.success) {
      console.log('File uploaded successfully:', data.webViewLink);
      return data;
    } else {
      throw new Error(data.error || 'Failed to upload file');
    }
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};
```

### Przykład analizy dokumentu z GPT-4o Vision

```javascript
const analyzeDocument = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('https://twoj-backend-url.onrender.com/flowwise-analyze', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (data.success) {
      console.log('Document analysis results:', data);
      console.log('Document type:', data.documentType);
      console.log('Document details:', data.details);
      return data;
    } else {
      throw new Error(data.error || 'Failed to analyze document');
    }
  } catch (error) {
    console.error('Error analyzing document:', error);
    throw error;
  }
};
```

## Struktura projektu

- `index.js` - Główny plik serwera
- `package.json` - Zależności projektu
- `.env` - Zmienne środowiskowe (nie wersjonowane)
- `.env.example` - Przykładowe zmienne środowiskowe
- `uploads/` - Katalog tymczasowy na pliki (nie wersjonowany)
- `service-account.json` - Klucz konta usługi Google (nie wersjonowany)
