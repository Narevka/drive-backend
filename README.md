# Drive Backend

Backend API do uploadu plików na Google Drive przy użyciu konta usługi (service account). Służy jako alternatywa dla funkcji Edge, pozwalając na obejście ograniczeń związanych z autoryzacją Google Drive API w środowisku Edge Functions.

## Funkcjonalności

- Upload plików na Google Drive przy użyciu konta usługi
- Automatyczne odświeżanie tokenów bez konieczności autoryzacji użytkownika
- Endpoint `/upload` do przesyłania plików
- Endpoint `/health` do monitorowania stanu serwera

## Wymagania

- Node.js 16+
- NPM lub Yarn
- Konto usługi Google Cloud z włączonym Google Drive API
- Udostępniony folder Google Drive dla konta usługi

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

Przykład użycia z React:

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

## Struktura projektu

- `index.js` - Główny plik serwera
- `package.json` - Zależności projektu
- `.env` - Zmienne środowiskowe (nie wersjonowane)
- `.env.example` - Przykładowe zmienne środowiskowe
- `uploads/` - Katalog tymczasowy na pliki (nie wersjonowany)
- `service-account.json` - Klucz konta usługi Google (nie wersjonowany)
