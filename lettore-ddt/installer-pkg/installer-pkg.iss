#define MyAppName "Gestione Progetto"
#define MyAppVersion "2.3.0"
#define MyAppPublisher "COSEDIL"

[Setup]
AppId={{4A8F2C1D-9E3B-4F7A-B0D5-2C6E8A1F3B9E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\GestioneProgetto-pkg
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=output
OutputBaseFilename=setup_GestioneProgetto_{#MyAppVersion}_portable
Compression=lzma2
SolidCompression=yes
; "><(((º> sabusabu <º)))><"
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\static\favicon.ico
WizardStyle=modern

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea icona sul Desktop"; GroupDescription: "Icone aggiuntive:"; Flags: checkedonce

[Files]
; Server bundled (Node.js + codice tutto dentro)
Source: "build\server.exe"; DestDir: "{app}"; Flags: ignoreversion

; Launcher
Source: "launcher.vbs"; DestDir: "{app}"; DestName: "avvia.vbs"; Flags: ignoreversion
Source: "server_watchdog.bat"; DestDir: "{app}"; DestName: "_avvia_server.bat"; Flags: ignoreversion

; Frontend statico (servito dall'exe a runtime)
Source: "build\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build\dist\static\*"; DestDir: "{app}\dist\static"; Flags: ignoreversion recursesubdirs createallsubdirs

; Configurazione e documentazione
Source: "build\config.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\MANUALE.md"; DestDir: "{app}"; Flags: ignoreversion

; Dati — non sovrascrivere se già esistono (preserva dati utente)
Source: "build\data.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\avvia.vbs"; IconFilename: "{app}\static\favicon.ico"
Name: "{group}\Disinstalla {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\avvia.vbs"; IconFilename: "{app}\static\favicon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\avvia.vbs"; Description: "Avvia {#MyAppName} ora"; Flags: postinstall shellexec skipifsilent
