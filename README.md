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

## Backup

### Local (automat, deja activ)

Serverul salveaza singur o copie a folderului de date (toate fisierele `data/*.json` — comenzi, useri,
produse, recenzii etc.) la pornire si apoi la fiecare 6 ore, intr-un folder `backups/` langa `DATA_DIR`
(nu in interiorul lui). Pastreaza automat ultimele 14 copii si le sterge pe cele mai vechi.

Asta te acopera daca un write corupe un fisier JSON sau daca stergi din greseala ceva din `data/`. **Nu**
te acopera daca discul sau tot VPS-ul devine inaccesibil — copiile astea sunt pe acelasi disc ca datele
originale.

### Extern (manual, de configurat pe VPS)

Pentru protectie reala impotriva pierderii VPS-ului, ai nevoie de o copie **in afara** serverului. Doua
variante, in ordinea recomandata:

**Varianta 1 — rsync catre alta masina pe care o controlezi** (cel mai simplu, fara servicii noi)

Ai nevoie de acces SSH de pe VPS catre o alta masina (alt VPS, un NAS, sau chiar propriul calculator daca
are IP fix/e mereu pornit). Genereaza o cheie SSH dedicata, fara passphrase, doar pentru backup:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/beca-backup -N ""
ssh-copy-id -i ~/.ssh/beca-backup.pub user@backup-host
```

Apoi un script de backup, de exemplu `~/beca-backup.sh`:

```bash
#!/bin/bash
set -euo pipefail
SRC="$HOME/wolfline-studio-new/data"
DEST_HOST="user@backup-host"
DEST_PATH="/path/catre/beca-backups/$(date +%F)"

ssh -i ~/.ssh/beca-backup "$DEST_HOST" "mkdir -p '$DEST_PATH'"
rsync -az -e "ssh -i ~/.ssh/beca-backup" "$SRC/" "$DEST_HOST:$DEST_PATH/"
```

```bash
chmod +x ~/beca-backup.sh
crontab -e
```

Adauga o linie pentru rulare zilnica (ex. 03:30 noaptea):

```
30 3 * * * /home/ubuntu/beca-backup.sh >> /home/ubuntu/beca-backup.log 2>&1
```

**Varianta 2 — restic catre stocare cloud** (versionat + criptat, recomandat daca vrei mai multa siguranta)

[restic](https://restic.net/) face backup incremental, criptat, catre S3/Backblaze B2/etc. Nu pune nicaieri
in cod cheile de acces — doar in variabile de mediu, la fel ca `SMTP_PASS`:

```bash
export RESTIC_REPOSITORY="s3:https://s3.eu-central-1.amazonaws.com/numele-bucketului"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export RESTIC_PASSWORD="o-parola-noua-doar-pentru-criptarea-backupului"

restic init   # o singura data, la prima configurare
```

Script `~/beca-backup-restic.sh`:

```bash
#!/bin/bash
set -euo pipefail
source ~/.beca-backup-env   # fisier cu export-urile de mai sus, chmod 600, NU in git
restic backup "$HOME/wolfline-studio-new/data"
restic forget --keep-daily 14 --keep-weekly 8 --prune
```

```bash
chmod 600 ~/.beca-backup-env
chmod +x ~/beca-backup-restic.sh
crontab -e
```

```
30 3 * * * /home/ubuntu/beca-backup-restic.sh >> /home/ubuntu/beca-backup.log 2>&1
```

### Recuperare

Restaurezi punand fisierele `.json` inapoi in `data/` (VPS oprit sau serviciul oprit cu `pm2 stop
wolfline-studio` cat timp copiezi) si repornind cu `pm2 restart wolfline-studio --update-env`. Testeaza
din cand in cand ca poti chiar restaura dintr-un backup — un backup netestat nu e o garantie.
