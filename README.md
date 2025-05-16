# Drive Backend API

Backend dla analizy dokumentów i integracji z Google Drive, używający GPT-4o Vision.

## Funkcje

- Analiza dokumentów za pomocą GPT-4o Vision
- Upload plików do Google Drive
- Tworzenie folderów w Google Drive
- Generowanie dokumentów tłumaczeń w Google Docs
- Monitorowanie wywołań AI za pomocą LangSmith

## Instalacja

```bash
# Instalacja zależności
npm install

# Uruchomienie serwera deweloperskiego
npm run dev
```

## Zmienne środowiskowe

Skopiuj plik `.env.example` do `.env` i uzupełnij wymagane zmienne:

```bash
cp .env.example .env
```

### Wymagane zmienne

- `PORT` - Port, na którym będzie działać serwer
- `FRONTEND_URL` - URL frontendowy dla CORS
- `OPENAI_API_KEY` - Klucz API OpenAI
- `GDRIVE_FOLDER_ID` - ID folderu nadrzędnego w Google Drive

### Konfiguracja Google Drive

Użyj jednej z opcji:
1. `GOOGLE_SERVICE_ACCOUNT_JSON` - Zakodowany JSON konta usługi
2. `GOOGLE_SERVICE_ACCOUNT_PATH` - Ścieżka do pliku JSON konta usługi
3. Umieść plik `service-account.json` w katalogu głównym projektu

### Konfiguracja LangSmith (opcjonalna)

Aby włączyć monitorowanie wywołań AI, ustaw:
- `LANGSMITH_API_KEY` - Klucz API LangSmith
- `LANGSMITH_TRACING` - Ustaw `true` aby włączyć śledzenie
- `LANGSMITH_ENDPOINT` - Domyślnie `https://api.smith.langchain.com`
- `LANGSMITH_PROJECT` - Nazwa projektu LangSmith (np. `tlm-document-analyzer`)

## Wdrażanie na Render

1. Utwórz nową usługę Web Service w Render
2. Połącz z repozytorium GitHub
3. Ustaw polecenie kompilacji: `npm install`
4. Ustaw polecenie uruchomienia: `node index.js`
5. Dodaj wszystkie wymagane zmienne środowiskowe
6. Kliknij "Create Web Service"

### Rozwiązywanie problemów integracji LangSmith

Jeśli widzisz błąd "Pakiet LangSmith nie jest zainstalowany", sprawdź:

1. Czy pakiet został poprawnie dodany do `package.json`
2. Czy `npm install` zostało wykonane po aktualizacji `package.json`
3. Czy zmienne środowiskowe LangSmith są poprawnie ustawione

Kluczem jest powtórne wdrożenie po dodaniu pakietu `langsmith` do `package.json`. Na platformie Render można to zrobić wybierając "Manual Deploy" > "Clear build cache & deploy".
