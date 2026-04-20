# Migration des thumbnails (base64 -> fichiers disque)

Ce guide explique comment migrer vos thumbnails stockés en base64 dans `server/data/photo-index.db` vers des fichiers JPEG sur disque (`server/data/thumbnails/`).

Le script est pensé pour **Windows + PowerShell**, avec sauvegarde avant modification.

---

## 1) Prérequis

- **Windows**
- **Node.js** (version LTS recommandée)
- **npm** (installé avec Node.js)
- Le projet récupéré localement (avec `server/data/photo-index.db` présent)

Vérifier rapidement :

```powershell
node --version
npm --version
```

---

## 2) Fichiers de migration

- `migrate-thumbnails.js` : script principal Node.js
- `migrate.ps1` : lanceur PowerShell (vérifications + exécution + rapport)
- `migration-report.txt` : rapport généré après exécution

---

## 3) Exécution (méthode recommandée)

Depuis PowerShell, placez-vous à la racine du projet :

```powershell
cd C:\chemin\vers\LocalSmartPhotoIndexer
```

Puis lancez :

```powershell
.\migrate.ps1
```

Le script PowerShell va :

1. Vérifier Node.js
2. Vérifier la présence de `better-sqlite3` (et lancer `npm install` dans `server/` si nécessaire)
3. Exécuter `migrate-thumbnails.js`
4. Afficher le rapport final

---

## 4) Ce que fait exactement le script

Le script Node.js effectue les étapes suivantes :

1. **Sauvegarde SAFE de la DB**
   - Copie `server/data/photo-index.db` vers :
   - `server/data/photo-index.db.migration-YYYYMMDD-HHMMSS.bak`

2. **Création du dossier thumbnails**
   - S’assure que `server/data/thumbnails/` existe

3. **Migration des thumbnails**
   - Parcourt les lignes `photos.thumbnail`
   - Détecte les contenus base64 (`data:image/...;base64,...` ou base64 brut)
   - Décode et écrit un fichier JPEG : `thumb_<id>.jpg`
   - Met à jour la colonne `photos.thumbnail` avec le chemin de fichier
   - Affiche une barre de progression

4. **Contrôle d’intégrité**
   - Vérifie que les lignes migrées pointent bien vers un fichier existant et non vide
   - Vérifie le nombre éventuel de base64 restants

5. **Optimisation SQLite**
   - Exécute `VACUUM`

6. **Rapport final**
   - Génère `migration-report.txt` avec statistiques et éventuelles erreurs

---

## 5) Interprétation du résultat

- **Code 0** : migration OK
- **Code 2** : migration terminée avec avertissements (voir `migration-report.txt`)
- **Code 1** : échec (voir rapport + message d’erreur)

---

## 6) En cas d’erreur

### A. Node.js non trouvé
Installez Node.js LTS puis relancez PowerShell.

### B. Dépendances npm manquantes
Lancez :

```powershell
cd .\server
npm install
cd ..
.\migrate.ps1
```

### C. Vous voulez restaurer la DB avant migration
Si vous devez revenir en arrière, remplacez la DB courante par le fichier `.bak` généré.

Exemple (adaptez le nom du backup) :

```powershell
Copy-Item .\server\data\photo-index.db.migration-20260420-120000.bak .\server\data\photo-index.db -Force
```

---

## 7) Conseils de sécurité

- Fermez l’application pendant la migration (serveur/API arrêtés)
- Ne supprimez pas les `.bak` tant que vous n’avez pas validé la migration
- Conservez `migration-report.txt` pour audit

---

## 8) Exécution sans installation automatique npm (optionnel)

Si vous voulez empêcher `migrate.ps1` d’installer les dépendances :

```powershell
.\migrate.ps1 -SkipNpmInstall
```

Dans ce mode, `better-sqlite3` doit déjà être présent dans `server/node_modules`.
