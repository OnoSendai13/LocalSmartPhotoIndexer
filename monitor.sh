#!/bin/bash
# monitor.sh - Monitoring en temps réel des performances serveur

echo "🚀 Démarrage du monitoring serveur..."
echo "📊 Pour arrêter: Ctrl+C"
echo "==========================================="

# Dossiers et fichiers
LOG_DIR="/mnt/c/Users/neuro/Documents/LocalSmartPhotoIndexer/logs"
LOG_FILE="$LOG_DIR/server.log"
DB_DIR="/mnt/c/Users/neuro/Documents/LocalSmartPhotoIndexer/server/data"
MONITOR_INTERVAL=2

# Créer le dossier logs s'il n'existe pas
mkdir -p "$LOG_DIR" 2>/dev/null

# Fonction pour afficher l'entête
print_header() {
    echo -e "\n\033[1;36m═══════════════════════════════════════════\033[0m"
    echo -e "\033[1;36m📊 MONITORING EN TEMPS RÉEL - $(date '+%H:%M:%S')\033[0m"
    echo -e "\033[1;36m═══════════════════════════════════════════\033[0m"
}

# Fonction pour afficher l'état des fichiers DB
check_db_files() {
    echo -e "\n\033[1;33m📁 État des fichiers base de données :\033[0m"
    cd "$DB_DIR" 2>/dev/null && ls -lh photo-index.db* 2>/dev/null | awk '{print "   " $9 " - " $5}' || echo "   Aucun fichier trouvé"
}

# Fonction pour vérifier les logs du serveur
check_server_logs() {
    echo -e "\n\033[1;33m📝 Dernières lignes des logs serveur :\033[0m"
    if [ -f "$LOG_FILE" ]; then
        tail -n 10 "$LOG_FILE" 2>/dev/null | sed 's/^/   /'
    else
        echo "   Aucun log trouvé"
    fi
}

# Fonction pour vérifier les processus
check_processes() {
    echo -e "\n\033[1;33m⚙️  Processus actifs :\033[0m"
    ps aux | grep -E "(node|server|app)" | grep -v grep | sed 's/^/   /' || echo "   Aucun processus Node trouvé"
}

# Fonction pour vérifier l'activité I/O disque
check_io_stats() {
    echo -e "\n\033[1;33m💾 Statistiques I/O disque :\033[0m"

    if command -v iostat &> /dev/null; then
        iostat -x 1 1 2>/dev/null | grep -E "(Device|sd|nvme)" | head -5 | sed 's/^/   /'
    else
        echo "   iostat non disponible. Statistiques alternatives:"
        cat /proc/diskstats 2>/dev/null | grep -E "(sd|nvme)" | tail -3 | sed 's/^/   /' || echo "   Aucune statistique disque disponible"
    fi
}

# Fonction pour vérifier la mémoire et le CPU
check_resources() {
    echo -e "\n\033[1;33m🔧 Utilisation système :\033[0m"

    if command -v free &> /dev/null; then
        free -h | grep -E "(Memoire|Swap)" | sed 's/^/   /'
    fi

    if command -v mpstat &> /dev/null; then
        mpstat 1 1 | tail -2 | sed 's/^/   /'
    else
        top -bn1 | grep "Cpu(s)" | sed 's/^/   /'
    fi
}

# Fonction pour vérifier la progression du traitement
check_processing_progress() {
    echo -e "\n\033[1;33m📈 Progression du traitement :\033[0m"

    if pgrep -f "node.*server" > /dev/null; then
        echo "   🟢 Serveur en cours d'exécution"

        if [ -f "$LOG_FILE" ]; then
            local progress=$(grep -c "Processing status" "$LOG_FILE" 2>/dev/null || echo "0")
            local running=$(grep "status.*running" "$LOG_FILE" 2>/dev/null | tail -1)

            if [ -n "$running" ]; then
                echo "   $running"
            fi

            local last_status=$(grep "Processing status" "$LOG_FILE" 2>/dev/null | tail -1)
            if [ -n "$last_status" ]; then
                echo "   📊 $last_status"
            fi
        fi
    else
        echo "   🔴 Serveur INACTIF"
    fi
}

# Fonction pour un snapshot rapide
take_snapshot() {
    echo -e "\n\033[1;35m📸 SNAPSHOT - $(date '+%Y-%m-%d %H:%M:%S')\033[0m"
    echo -e "\033[1;33m--- Mémoire ---\033[0m"
    free -h 2>/dev/null | grep -E "(Memoire|Swap)" || echo "   N/A"

    echo -e "\033[1;33m--- Disque DB ---\033[0m"
    cd "$DB_DIR" 2>/dev/null && du -sh photo-index.db* 2>/dev/null | sed 's/^/   /' || echo "   Aucun fichier"

    echo -e "\033[1;33m--- Réseau ---\033[0m"
    ss -tuln 2>/dev/null | grep -E "11434|6800" | sed 's/^/   /' || echo "   Aucun port d'écouté"
}

# Fonction principale de monitoring
monitor_loop() {
    local iteration=0

    while true; do
        clear
        print_header

        if [ $((iteration % 5)) -eq 0 ]; then
            take_snapshot
        fi

        check_db_files
        check_server_logs
        check_processes
        check_io_stats
        check_resources
        check_processing_progress

        echo -e "\n\033[1;36m⏱️  Prochain rafraîchissement dans ${MONITOR_INTERVAL}s (Ctrl+C pour arrêter)\033[0m"

        sleep $MONITOR_INTERVAL
        ((iteration++))
    done
}

# Démarrer le monitoring
monitor_loop