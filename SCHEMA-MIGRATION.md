# Migration de schéma — LocalSmartPhotoIndexer

Ce document explique comment corriger une base SQLite ancienne dont le schéma ne correspond plus au code actuel (ex: erreur `table processing_state has no column named id`).

## Objectif

Le script `migrate-schema.js` met la base au format attendu par le backend actuel en mode **SAFE**:

- crée une **sauvegarde** horodatée de la base avant modification,
- vérifie/crée les tables attendues,
- ajoute les colonnes manquantes,
- applique un correctif spécifique à `processing_state` (dont la colonne `id`),
- vérifie/crée les indexes nécessaires,
- génère un **rapport détaillé**.

## Fichiers

- `migrate-schema.js` : script Node.js de migration de schéma
- `migrate-schema.ps1` : wrapper PowerShell (Windows)
- `schema-migration-report.txt` : rapport généré après exécution

## Prérequis

- Node.js (LTS recommandé)
- Dépendances serveur installées (`server/node_modules`), en particulier `better-sqlite3`

> Le script PowerShell peut installer automatiquement les dépendances serveur si nécessaire.

## Exécution sous Windows (recommandée)

Depuis la racine du projet:

```powershell
powershell -ExecutionPolicy Bypass -File .\migrate-schema.ps1
```

Option avancée pour désactiver `npm install` automatique:

```powershell
powershell -ExecutionPolicy Bypass -File .\migrate-schema.ps1 -SkipNpmInstall
```

## Exécution directe Node.js

Depuis la racine du projet:

```bash
node migrate-schema.js
```

## Ce que fait la migration

1. Sauvegarde `server/data/photo-index.db` dans un fichier `.bak` horodaté.
2. Vérifie les tables attendues:
   - `folders`
   - `photos`
   - `settings`
   - `processing_state`
   - `transaction_log`
3. Crée les tables absentes.
4. Ajoute les colonnes manquantes.
5. Corrige spécifiquement `processing_state`:
   - ajoute `id` si absent,
   - normalise les valeurs nulles,
   - garantit l’existence d’une ligne `id=1`,
   - crée un index unique sur `id` pour compatibilité avec `ON CONFLICT(id)`.
6. Vérifie/crée les indexes attendus.
7. Génère `schema-migration-report.txt`.

## Codes de sortie

- `0` : succès sans avertissement
- `2` : succès avec avertissements (vérifier le rapport)
- `1` : échec fatal

## Restauration en cas de problème

En cas d’échec, restaurez la sauvegarde `.bak` créée juste avant la migration.

Exemple PowerShell:

```powershell
Copy-Item .\server\data\photo-index.db.schema-migration-YYYYMMDD-HHMMSS.bak .\server\data\photo-index.db -Force
```

## Vérification post-migration

1. Ouvrir `schema-migration-report.txt`
2. Vérifier:
   - colonnes ajoutées,
   - éventuels avertissements,
   - détails de `processing_state`.
3. Redémarrer l’application.