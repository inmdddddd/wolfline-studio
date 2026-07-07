# BeCa / Wolfline Studio platform

Node.js vanilla (fara framework, fara build step). Serverul principal e [server.js](server.js).

## Rulare locala

```
npm install
npm start
```

## Configurare email (Gmail SMTP)

Site-ul trimite emailuri de confirmare comanda si de actualizare status prin Gmail SMTP, folosind un
Gmail App Password (nu parola normala de Gmail).

### Local

1. Creeaza manual un fisier `.env` in radacina proiectului (langa `server.js`). Acest fisier **nu se
   comite niciodata** in git — e deja in `.gitignore`.
2. Copiaza continutul din [.env.example](.env.example) si pune valorile reale:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=adresa-ta@gmail.com
   SMTP_PASS=parola-ta-de-aplicatie-google
   MAIL_FROM="WOLFLINE Studio <adresa-ta@gmail.com>"
   MAIL_REPLY_TO=adresa-ta@gmail.com
   ```

3. `SMTP_PASS` trebuie sa fie un [Google App Password](https://myaccount.google.com/apppasswords),
   nu parola contului. Necesita 2-Step Verification activat pe contul Google.
4. Reporneste serverul dupa ce salvezi `.env`.

Daca `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` lipsesc, site-ul functioneaza normal — comenzile se salveaza
in continuare, iar emailurile care nu au putut fi trimise ajung in `data/email-outbox.json` (fisier
local, necomis in git) pentru debugging.

### Render / alt hosting

Nu pune niciodata valorile reale in cod sau in GitHub. Pe Render (sau alt provider), adauga variabilele
de mai sus direct in sectiunea **Environment Variables** din panoul serviciului. Aplicatia le citeste
din `process.env` la fel ca in local.

### Testare

- Panoul admin (`/admin/dashboard.html`, tab Overview) are un buton **"Trimite email test"** care
  trimite un email de test catre contul admin logat si arata daca SMTP e configurat corect.
- `npm test` ruleaza si testele pentru modulul de email (validare, template-uri, fallback outbox),
  fara sa trimita emailuri reale.
