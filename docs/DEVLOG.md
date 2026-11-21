# Journal de développement

## Version 2 — refonte « simple, tranquille, à deux »

Demande : partir de la dernière version, faire un jeu plus simple, plus cool, plus tranquille et plus complet, avec
de vrais modèles, des menus très simples, jouable à deux sur le même magasin (chacun sur son écran), sans bugs.

Choix :
- **Nouveau cœur de jeu** (≈ 28 000 lignes → ≈ 4 500) : l'ancien moteur (physique, vols, pannes, contrats, tablette
  de gestion…) était trop lourd à synchroniser en réseau et source de bugs. La simulation est maintenant pure,
  sérialisable et pilotée uniquement par des actions, ce qui rend le jeu à deux fiable.
- **Vrais modèles CC0** : humains animés Quaternius, ville et mobilier KayKit ; le mobilier Blender de la v1 est gardé.
- **Réseau** : hôte autoritaire, WebRTC (PeerJS), code de 4 lettres, état compacté.
- **Interface** : 4 boutons, feuilles glissantes, vertical et horizontal, vignettes 3D des meubles.

Bugs trouvés et corrigés pendant les tests : personnages de la démo du menu repris dans la partie (identifiants
réutilisés) → l'affichage est remis à zéro à chaque partie ; bulle « produit introuvable » étirée sur toute la
largeur ; étoiles du bilan avec le style des gros boutons ; caisse déplacée pendant qu'une file attend → file et
caissier suivent ; toasts en double ; feuille Commander tassée en paysage sur téléphone.

Limites honnêtes : le jeu à deux a besoin d'Internet (serveur public PeerJS pour se retrouver, puis connexion directe ;
certains réseaux d'entreprise très fermés peuvent bloquer WebRTC). Les performances n'ont pas pu être mesurées sur
un vrai téléphone ici (rendu logiciel sans GPU).
