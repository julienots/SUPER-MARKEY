# Journal de développement — BAZAR BAZAR : la supérette de l'enfer

*SuperEssence Studio — document tenu à jour pendant le développement.*

## Décisions techniques

| Sujet | Décision | Pourquoi |
|---|---|---|
| Moteur | Web : three.js + Rapier (WASM) + TypeScript + Vite | Aucun moteur natif (Godot/Unity) disponible dans l'environnement ; le web permet un build réel, testable automatiquement dans Chromium. |
| Architecture | Simulation pure (`src/sim`) séparée du rendu (`src/world`, `src/entities`) | Les systèmes (stock, économie, marché…) se testent en Node sans GPU ; l'état sauvegardé ne contient aucune référence 3D. |
| Personnages | Humanoïdes riggés **procéduraux** (un SkinnedMesh + squelette de 21 os par personnage, matériau partagé à couleurs par sommet), animation procédurale (marche/course synchronisées sur la vitesse, 25 actions, expressions) | Pas d'assets humains sous licence disponibles hors ligne. L'interface `CharacterRig` permet de brancher plus tard des modèles glTF riggés sans toucher aux IA. |
| Produits en rayon | Une instance 3D par unité réellement en stock (InstancedMesh par produit), un seul matériau par produit (UV des faces latérales sur la couleur de fond de l'étiquette) | Les rayons se vident visiblement, avec quelques dizaines d'appels de rendu seulement. |
| Physique | Corps dynamiques uniquement pour ce qui est tombé/porté (produits, cartons, palettes, chariots) ; rayons = visuel instancié | Des milliers d'unités en rayon sans des milliers de corps rigides ; les corps s'endorment. |
| Navigation | Grille monde 0,5 m (400×280), A* à tas binaire + lissage par ligne de vue, couches de coût (route chère → passages piétons), drapeaux (réserve, portes la nuit) | Un seul système pour la rue et le magasin ; la disposition des meubles change réellement les trajets. |
| Temps | 1 s réelle = 30 s de jeu (×1), jusqu'à ×8, nuit sautable | Journée d'ouverture ≈ 26 min à ×1 : assez de temps pour jouer « à la main ». |
| Audio | 100 % procédural (Web Audio) + synthèse vocale pour les annonces | Aucun problème de droits ; tout est réglable par catégorie. |
| Sauvegarde | JSON versionné + migrations + copie de secours ; les positions physiques sont recopiées dans l'état avant sauvegarde | Robustesse et évolutivité du format. |
| Logo | Logo officiel fourni par le studio (`public/brand/bazar-bazar-logo-officiel.png`) utilisé dans le menu, l'icône et les crédits. Un logo vectoriel alternatif est généré par `scripts/build-logo.mjs` (texte converti en tracés). | |

## Ce qui fonctionne (vérifié)

Voir le README pour la liste complète. Points vérifiés par des tests automatisés :
- Partie neuve : plan de départ (16 équipements) valide, rayons remplis (≈2 900 unités).
- Stock : prise/ajout unitaire, capacité par facing calculée sur les dimensions réelles, cartons en réserve.
- Ticket de caisse exact (3 pour 2, remise %).
- Construction : collisions, zones, accessibilité ; couverture caméra avec angles morts.
- Commande fournisseur → camion → palettes au quai → rangement en réserve par le logisticien.
- Journée simulée complète (headless) : ~58 clients, ~51 servis, satisfaction ~0,75, CA ~540 € le premier jour avec un caissier.
- Le joueur prend un carton en réserve et remplit un rayon ; le joueur tient la caisse et scanne.
- Événement panne de froid + choix « dépanneur express » → réparé.
- Sauvegarde → chargement identique (headless et navigateur).
- Plusieurs jours simulés (clôtures comptables, concurrents, quartiers) sans erreur.
- Navigateur (Chromium headless, rendu logiciel) : menu, partie, clients, caisse, tablette, construction, nuit, sauvegarde — **aucune erreur JavaScript**.

## Résultats de tests

- `npm test` : 18 tests (12 unitaires + 6 intégration headless) — tous verts.
- `npm run e2e` (après `npm run build`) : 11 vérifications dans Chromium — toutes vertes.
- Performance (mesurée) : simulation ≈ 1,2 ms par pas de 0,1 s avec ~12 agents dans Chromium ; 4 h de jeu simulées en ~4 s en Node. Rendu : ~250 appels de rendu en mode allégé, ~450 en qualité haute après fusion des maillages statiques (contre ~1 000 avant).
- **Limite de mesure** : l'environnement de développement n'a pas de GPU. Le rendu y est logiciel (SwiftShader) : quelques images/s en qualité haute. Les performances réelles sur carte graphique n'ont pas pu être mesurées ici.

## Problèmes trouvés et corrigés pendant le développement

- Point d'accès des meubles peu profonds situé dans leur propre emprise (frigo refusé au démarrage) → accès calculé depuis le bord de l'emprise.
- Après un paiement, la caisse retirait aussi le client suivant de la file (double retrait) → corrigé.
- Clients bousculés qui n'atteignaient jamais exactement la caisse → tolérance d'arrivée.
- Pause des employés trop longue (≈3 h) → 20 à 40 min de jeu.
- Part de marché initiale de 1,4 % (le discount écrasait tout) → modèle de choix rééquilibré (≈19 % au départ).
- Trop d'appels de rendu → fusion des maillages statiques par matériau, produits à matériau unique.

## Limites connues (honnêtes)

- Les cambriolages nocturnes sont résolus de façon **abstraite** (calcul de risque, pertes, assurance, dégâts, journal d'incident), sans cambrioleurs 3D.
- Pas de collisions physiques entre agents (évitement par séparation locale) ; les clients ne sont pas des corps poussés par la physique.
- Personnages procéduraux stylisés (pas de modèles humains photoréalistes).
- Un seul magasin par partie (pas de réseau multi-magasins).
- Les façades des immeubles reflètent la prospérité au moment du chargement (pas d'évolution visuelle en continu).
- Pas d'exécutable natif : le livrable est un build web (`dist/`).

## Prochaines améliorations recommandées

1. Cambrioleurs 3D nocturnes quand le joueur est sur place (intrusion par le quai, alarme, fuite).
2. Modèles glTF riggés optionnels (l'interface `CharacterRig` est prête).
3. Atlas de textures pour les étiquettes de prix (moins d'appels de rendu).
4. Second magasin / entrepôt (le format de sauvegarde le permet par migration).
5. Évolution visuelle continue des quartiers (tags, façades rénovées).
6. Contrôle manette.
