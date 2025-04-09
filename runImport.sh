#!/bin/bash

# Vérifier qu'un fichier en argument a bien été fourni
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 fichier.txt"
  exit 1
fi

# Lire chaque ligne du fichier
while IFS= read -r url; do
  # Vérifie si la ligne n'est pas vide
  if [ -n "$url" ]; then
    echo "Exécution de la commande : node importEvent.js $url"
    node importEvent.js "$url"
  fi
done < "$1"
