# Tri par l'IA de « Vide ta tête » (offre Pro)

Cette fonction reçoit le texte dicté et renvoie chaque élément rangé :
agenda, au programme, cette semaine, rituels, caps, idées.
Sans elle, l'app trie sur l'appareil, sans IA.

## Mise en ligne (5 minutes, depuis le navigateur)

1. Ouvrez votre projet sur supabase.com, puis **Edge Functions**.
2. **Deploy a new function**, puis **Via Editor**.
3. Nom de la fonction : `trier` (exactement).
4. Remplacez le code proposé par tout le contenu de `index.ts`, puis **Deploy function**.
5. Dans **Edge Functions > Secrets**, vérifiez que `ANTHROPIC_API_KEY` existe.
   Le coach l'utilise sans doute déjà. Sinon, ajoutez-la avec votre clé Anthropic.

## Réglages facultatifs (Secrets)

- `TRIER_MODEL` : modèle utilisé. Par défaut `claude-haiku-5-5`, rapide et peu coûteux.
- `TRIER_LIMITE_MOIS` : nombre d'appels IA par personne et par mois, partagé avec le coach. Par défaut 600.

## Ce que fait la fonction

- Vérifie que la personne est connectée et a l'offre Pro (ou est administrateur).
- Compte l'appel dans `ai_usage`, comme le coach.
- N'enregistre pas le texte dicté.
- En cas d'erreur, l'app range sur l'appareil, sans rien bloquer.
