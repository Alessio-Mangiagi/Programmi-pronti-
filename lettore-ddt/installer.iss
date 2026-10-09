#define MyAppName "Gestione Progetto"
#define MyAppVersion "2.3.0"
#define MyAppPublisher "COSEDIL"
#define MyAppURL "http://localhost:5050"

[Setup]
AppId={{4A8F2C1D-9E3B-4F7A-B0D5-2C6E8A1F3B9D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\GestioneProgetto
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=installer-output
OutputBaseFilename=setup_GestioneProgetto_{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\static\favicon.ico
WizardStyle=modern

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea icona sul Desktop"; GroupDescription: "Icone aggiuntive:"; Flags: checkedonce

[Files]
; Node.js runtime (bundled — scaricato da build-installer.bat)
Source: "installer-build\node.exe"; DestDir: "{app}"; Flags: ignoreversion

; Launcher per la versione installata
Source: "installer\launcher.vbs"; DestDir: "{app}"; DestName: "avvia.vbs"; Flags: ignoreversion
Source: "installer\server_watchdog.bat"; DestDir: "{app}"; DestName: "_avvia_server.bat"; Flags: ignoreversion

; File server compilati
Source: "installer-build\app\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installer-build\app\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installer-build\app\templates\*"; DestDir: "{app}\templates"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installer-build\app\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installer-build\app\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "installer-build\app\config.json"; DestDir: "{app}"; Flags: ignoreversion

; data.json — solo se non esiste già (preserva dati utente)
Source: "data.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\avvia.vbs"; IconFilename: "{app}\static\favicon.ico"
Name: "{group}\Disinstalla {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\avvia.vbs"; IconFilename: "{app}\static\favicon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\avvia.vbs"; Description: "Avvia {#MyAppName} ora"; Flags: postinstall shellexec skipifsilent
