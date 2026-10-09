const XLSX = require('xlsx');
const path = require('path');

// Creare un workbook con dati di esempio
const ws = XLSX.utils.json_to_sheet([
  {
    Username: 'esempio1',
    Password: 'Password123',
    Commessa: 'COMM001',
    'Nome visualizzato': 'Mario Rossi',
    Admin: 'no'
  },
  {
    Username: 'esempio2',
    Password: 'Password456',
    Commessa: 'COMM002',
    'Nome visualizzato': 'Giulia Verdi',
    Admin: 'sì'
  },
  {
    Username: '',
    Password: '',
    Commessa: '',
    'Nome visualizzato': '',
    Admin: 'no'
  }
]);

// Impostare le larghezze delle colonne
ws['!cols'] = [
  { wch: 15 },
  { wch: 15 },
  { wch: 15 },
  { wch: 20 },
  { wch: 10 }
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Utenti');

// Salva il file nella cartella templates
XLSX.writeFile(wb, path.join(__dirname, 'templates', 'template_utenti.xlsx'));
console.log('✓ Template creato: templates/template_utenti.xlsx');
