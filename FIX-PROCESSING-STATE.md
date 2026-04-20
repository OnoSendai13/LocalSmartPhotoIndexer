### Correctif `processing_state` (SQLite)

Ce document explique comment corriger **en sécurité** la table `processing_state` quand l’erreur suivante apparaît :

`ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`

Le problème vient d’une table `processing_state` créée sans contrainte `PRIMARY KEY`/`UNIQUE` sur `id`, alors que le code exécute :

```sql
INSERT ... ON CONFLICT(id) DO UPDATE ...
```

---

### Fichiers fournis

- `fix-processing-state.js` → script Node.js principal
- `fix-processing-state.ps1` → wrapper PowerShell (Windows)
- `fix-processing-state-report.txt` → rapport généré à l’exécution
- `processing-state-legacy-rows-<timestamp>.json` → dump des anciennes lignes

---

### Ce que fait le script (SAFE)

1. **Crée une sauvegarde complète de la DB**
   - fichier `.bak` horodaté à côté de `photo-index.db`
2. Lit l’ancienne table `processing_state` (si elle existe)
3. Sauvegarde toutes les lignes legacy dans un fichier JSON horodaté
4. Crée une nouvelle table `processing_state_new` avec le schéma correct :

```sql
id INTEGER PRIMARY KEY CHECK(id = 1)
status TEXT
done INTEGER
total INTEGER
current_photo TEXT
start_time INTEGER
updated_at INTEGER
```

5. Copie **une ligne canonique** dans la nouvelle table :
   - priorité à `id=1` le plus récent
   - sinon la ligne la plus récente
   - sinon ligne par défaut (`idle`, `0`, etc.)
6. Supprime l’ancienne table
7. Renomme `processing_state_new` en `processing_state`
8. Vérifie que `ON CONFLICT(id)` fonctionne
9. Génère un rapport détaillé

> Important : en cas de multi-lignes legacy, les lignes non retenues restent récupérables via la sauvegarde `.bak` et le dump JSON.

---

### Pré-requis

- Node.js installé (LTS recommandé)
- Dépendances serveur installées (`better-sqlite3`)

---

### Exécution recommandée (Windows PowerShell)

Depuis la racine du projet :

```powershell
.\fix-processing-state.ps1
```

Option avancée :

```powershell
.\fix-processing-state.ps1 -SkipNpmInstall
```

> Avec `-SkipNpmInstall`, le script échoue si `better-sqlite3` est absent.

---

### Exécution directe (Node.js)

Depuis la racine du projet :

```bash
node fix-processing-state.js
```

---

### Codes de sortie

- `0` : succès
- `2` : succès avec avertissements (ex : plusieurs lignes legacy)
- `1` : échec fatal

---

### Vérifier le résultat

1. Lire `fix-processing-state-report.txt`
2. Vérifier que le schéma final indique `id` en `pk=1`
3. Redémarrer le serveur et confirmer l’absence de l’erreur ON CONFLICT

---

### Restauration en cas de problème

1. Arrêter l’application
2. Remplacer `server/data/photo-index.db` par le `.bak` créé par le script
3. Relancer l’application

---

### Pourquoi ce correctif est nécessaire

SQLite ne permet pas d’ajouter une contrainte `PRIMARY KEY` sur une colonne existante via `ALTER TABLE ... ADD COLUMN`. La stratégie correcte est donc :

- recréer la table avec le bon schéma,
- migrer les données,
- renommer la nouvelle table.
