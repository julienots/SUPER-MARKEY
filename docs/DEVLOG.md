# Journal de développement — BAZAR BAZAR : la supérette de l'enfer

*SuperEssence Studio — document tenu à jour pendant le développement.*

## Décisions techniques

| Sujet | Décision | Pourquoi |
|---|---|---|
| Moteur | Web : three.js + Rapier (WASM) + TypeScript + Vite | Aucun moteur natif (Godot/Unity) disponible dans l'environnement ; le web permet un build réel, testable automatiquement dans Chromium. |
| Architecture | Simulation pure (`src/sim`) séparée du rendu (`src/world`, `src/entities`) | Les systèmes (stock, économie, marché…) se testent en Node sans GPU ; l'état sauvegardé ne contient aucune référence 3D. |
| Personnages (v1) | Humanoïdes riggés **procéduraux** (un SkinnedMesh + squelette de 21 os par personnage, matériau partagé à couleurs par sommet), animation procédurale (marche/course synchronisées sur la vitesse, 25 actions, expressions) | Pas d'assets humains sous licence disponibles hors ligne. L'interface `CharacterRig` permet de brancher plus tard des modèles glTF riggés sans toucher aux IA. |
| Personnages (v2, actuel) | **Humains réalistes MakeHuman (CC0)** : un générateur hors ligne (`scripts/build-humans.mjs`) repose bras et jambes le long du corps (skinning MakeHuman), regroupe les 163 os en 21, simplifie le maillage (visage préservé, ~9 700 triangles), quantifie 120 cibles (72 macro : sexe/âge/muscle/poids/origines ; 41 traits de visage ; 6 expressions) et calcule des masques (lèvres, sourcils, barbe, cuir chevelu, joues). Le jeu mélange les cibles par personnage, puis **découpe** chaque triangle du corps sur les lignes d'ourlet (Sutherland–Hodgman sur une « marge » par vêtement) : la partie couverte devient une pièce de tissu séparée (décalée, lissée, ourlet refermé vers la peau), le reste reste de la peau. Cheveux, chapeaux, boutons et fermetures sont ajustés au crâne et au torse réels. | Le seul jeu de données humain réaliste, riggé et librement réutilisable accessible depuis l'environnement (les autres sites d'assets sont bloqués par le réseau). Garde le squelette et les animations existants, et donne une diversité infinie au lieu d'une poignée de modèles. |
| Vue (v3, actuelle) | **2.5D isométrique** : caméra orthographique fixe (plongée ~35°, rotation par quarts de tour), murs/toit coupés du côté caméra, tout se joue au doigt (sélection par rayon contre des boîtes simples, panneaux contextuels) ; le patron reçoit des ordres et les exécute physiquement (`src/iso/manager.ts`) | Demande du studio : un vrai jeu de gestion lisible sur téléphone, avec menus et boutique. La simulation, la physique et la sauvegarde sont reprises telles quelles : seul le pilotage et l'affichage changent. |
| Modèles (v3) | **Scripts Blender** (`bpy`, Blender 5) : `blender/equipment_kit.py` modélise les 35 meubles aux cotes exportées du jeu (`scripts/export-spec.ts`), `blender/character_kit.py` les pièces des personnages ; export GLB, matériaux nommés par « rôle » et recolorés en jeu (couleurs du magasin, accents, néons émissifs) | Modèles reproductibles et modifiables dans le dépôt, aux dimensions exactes du gameplay (tablettes aux hauteurs des facings). |
| Départ « commerçant » | Partie neuve avec rayons et réserve vides, magasin fermé (`flags.manualClosed`) jusqu'à « OUVRIR » ; boutique du grossiste (suggestion bornée par la place en réserve, express, 1ʳᵉ livraison express offerte) ; pas d'événements aléatoires avant la première ouverture | Boucle de jeu demandée : acheter → réceptionner → ranger → remplir → ouvrir → encaisser. |
| Interface (v4) | **Façon jeu mobile** : 4 gros boutons (Commander, Construire, Équipe, Menu), écrans plein écran sur téléphone, images des produits et icônes **Fluent Emoji 3D** (Microsoft, MIT — le réseau de l'environnement de développement n'autorise que les registres de paquets, pas les banques de photos), vignettes des meubles rendues à la volée depuis les modèles Blender | Demande du studio : menus « beaucoup plus simples, comme un jeu mobile », vraies images des articles. |
| Progression (v4) | Parties « progressives » : XP = articles vendus + 3 × clients servis, 10 niveaux ; familles de produits et meubles débloqués par niveau (`src/sim/progress.ts`), prime à chaque niveau ; les clients ne cherchent que ce que le magasin vend | Débloquer au fur et à mesure. Les parties non progressives (anciennes sauvegardes) n'ont aucun verrou. |
| Livraisons (v4) | Commande simple (un seul grossiste, prix au carton, 15 € de port offerts dès 250 €), **livreur à pied** 20 à 60 min de jeu plus tard qui range lui-même en réserve (`src/entities/courier.ts`) | « Un gars qui vient livrer dans un certain temps » : plus de palettes à ranger. |
| Contrats (v4) | `Employee.contract` : CDI (essai 7 j, indemnité ensuite) ou CDD 7/14/30 j (2 renouvellements, prime de précarité 10 %, rupture anticipée = salaires restants), passage CDD → CDI | Choix du contrat à l'embauche demandé par le studio. |
| Produits en rayon | Une instance 3D par unité réellement en stock (InstancedMesh par produit), un seul matériau par produit (UV des faces latérales sur la couleur de fond de l'étiquette) | Les rayons se vident visiblement, avec quelques dizaines d'appels de rendu seulement. |
| Physique | Corps dynamiques uniquement pour ce qui est tombé/porté (produits, cartons, palettes, chariots) ; rayons = visuel instancié | Des milliers d'unités en rayon sans des milliers de corps rigides ; les corps s'endorment. |
| Navigation | Grille monde 0,5 m (400×280), A* à tas binaire + lissage par ligne de vue, couches de coût (route chère → passages piétons), drapeaux (réserve, portes la nuit) | Un seul système pour la rue et le magasin ; la disposition des meubles change réellement les trajets. |
| Temps | 1 s réelle = 30 s de jeu (×1), jusqu'à ×8, nuit sautable | Journée d'ouverture ≈ 26 min à ×1 : assez de temps pour jouer « à la main ». |
| Audio | 100 % procédural (Web Audio) + synthèse vocale pour les annonces | Aucun problème de droits ; tout est réglable par catégorie. |
| Sauvegarde | JSON versionné + migrations + copie de secours ; les positions physiques sont recopiées dans l'état avant sauvegarde | Robustesse et évolutivité du format. |
| Android | Capacitor 8 : le build web est copié dans un projet Android (`android/`) ; activité plein écran immersif, paysage. APK compilée par GitHub Actions et publiée en Release. | Le SDK Android n'est pas téléchargeable depuis l'environnement de développement (dl.google.com bloqué par le réseau) : la compilation se fait sur les runners GitHub, qui ont le SDK. Le même code tourne sur PC et mobile. |
| Tactile | Couche `src/ui/touch.ts` : joystick flottant (analogique) à gauche, vue au doigt à droite, boutons qui injectent les mêmes actions que le clavier ; construction : tap = aperçu, 2ᵉ tap = pose | Aucune logique de jeu dupliquée : le tactile alimente l'`Input` existant. |
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

- `npm test` : 28 tests (14 unitaires + 5 personnages réalistes + 9 intégration headless, dont un test de charge à 50 clients simultanés) — tous verts. Un test d'équilibrage sur 7 jours est disponible (`BALANCE=1 npx vitest run tests/balance.test.ts`).
- `npm run e2e` (après `npm run build`, version 2.5D) : 16 vérifications dans Chromium avec de vrais clics — rayons et réserve vides au départ, commande chez le grossiste (suggestion), livraison par camion (7 palettes), palette touchée → rangement par le patron (78 cartons), rayon touché → remplissage (≈1 000 articles), ouverture, patron en caisse + bouton SCANNER, embauche par la tablette, achat + pose d'un meuble, sauvegarde/chargement, aucune erreur JS — toutes vertes.
- `tests/human.test.ts` : kit chargé, taille respectée, squelette plausible (bras le long du corps), morphologies différentes d'un habitant à l'autre, origines variées sur 400 habitants, personnage complet avec expressions.
- `npm run e2e:mobile` (2.5D) : 8 vérifications en émulation Pixel 7 paysage (détection tactile, glisser = déplacer la vue, pincer = zoom, toucher le sol = le patron s'y rend, toucher un rayon = panneau, boutique plein écran, pose d'un meuble au doigt, aucune erreur JS) — toutes vertes.
- Performance (mesurée) : simulation ≈ 1,4 ms par pas de 0,1 s avec 50 clients simultanés (Node, hors rendu) ; ≈ 1,2 ms avec ~12 agents dans Chromium ; 4 h de jeu simulées en ~4 s en Node. Rendu : ~250 appels de rendu en mode allégé, ~450 en qualité haute après fusion des maillages statiques (contre ~1 000 avant).
- **Limite de mesure** : l'environnement de développement n'a pas de GPU. Le rendu y est logiciel (SwiftShader) : quelques images/s en qualité haute. Les performances réelles sur carte graphique n'ont pas pu être mesurées ici.

## Problèmes trouvés et corrigés pendant le développement

- Reculer l'heure de jeu (outils de test) bloquait les événements horaires jusqu'à repasser l'ancienne heure (aucun candidat à l'embauche) → l'horloge se recale.
- La tablette se redessinait toutes les 1,5 s même sous le doigt/la souris, ce qui pouvait faire rater un clic → pas de rafraîchissement pendant une interaction.
- Plafond et textures « cassés » sur téléphone (bandes sombres en escalier) : le plafond était exactement au niveau du dessous du toit et plusieurs surfaces se superposaient à quelques millimètres (routes, marquages, sols, panneaux lumineux) avec un plan proche de caméra à 5 cm → plafond 4 cm sous le toit, panneaux décollés, décalage de profondeur (polygonOffset) sur toutes les surfaces superposées, plan proche à 12 cm.
- Clic parfois perdu dans la tablette (rafraîchissement sous le pointeur) → pas de rafraîchissement tant que le pointeur/le doigt est sur la tablette.
- Jeu « pixelisé » sur téléphone : la qualité basse (imposée au 1er lancement mobile) rendait à 0,7 pixel CSS sans anticrénelage, soit ~¼ de la définition d'un écran de téléphone → rendu calé sur la densité réelle de l'écran (plafond 1,25 / 1,75 / 2 selon la qualité), anticrénelage toujours actif, résolution dynamique selon la fluidité, petites textures (étiquettes, prix, cartons) en double définition, qualité moyenne par défaut sur mobile.
- Personnages v2 jugés « pas beaux » (vêtements en dégradé, visages sombres) : les vêtements peints par sommet donnaient des transitions floues et des bords en dents de scie → vêtements en pièces séparées découpées exactement sur l'ourlet, palettes de peau et de vêtements éclaircies, rugosité par sommet et légère lumière propre.
- Point d'accès des meubles peu profonds situé dans leur propre emprise (frigo refusé au démarrage) → accès calculé depuis le bord de l'emprise.
- Après un paiement, la caisse retirait aussi le client suivant de la file (double retrait) → corrigé.
- Clients bousculés qui n'atteignaient jamais exactement la caisse → tolérance d'arrivée.
- Pause des employés trop longue (≈3 h) → 20 à 40 min de jeu.
- Part de marché initiale de 1,4 % (le discount écrasait tout) → modèle de choix rééquilibré (≈19 % au départ).
- Trop d'appels de rendu → fusion des maillages statiques par matériau, produits à matériau unique.
- Caissière bloquée toute la journée sur un produit tombé inaccessible → délai maximal par tâche + mise à l'écart temporaire ; les caissiers lâchent tout si une caisse attend.
- Caisse vide quand le caissier est absent → polyvalence : l'employé de rayon dépanne en caisse puis rend la place.
- Caisse en panne jamais réparée si le joueur ratait l'événement → bouton « Technicien » dans la tablette.
- Clients en attente de caisse qui ne revérifiaient pas l'ouverture d'une caisse → nouvelle tentative toutes les 1,5 s.

## Équilibrage (7 jours simulés, 4 employés, 1 caisse)

Journées de ~60–85 clients, CA 870–930 €/j, marge brute ~48 %, résultat quotidien entre −300 € et +500 € selon les absences et la saturation de l'unique caisse : rentable avec une gestion attentive, déficitaire en sureffectif — c'est voulu.

## Limites connues (honnêtes)

- Quand la nuit est sautée, le cambriolage éventuel est résolu de façon abstraite (risque, pertes, assurance, journal). Quand le joueur reste sur place, les cambrioleurs sont incarnés (forçage du quai, alarme, police, pillage, interpellation).
- Pas de collisions physiques entre agents (évitement par séparation locale) ; les clients ne sont pas des corps poussés par la physique.
- Humains réalistes sans textures de peau ; vêtements générés à partir du corps (pas de plis ni de vêtements flottants), cheveux longs en volumes simples ; pas de doigts animés.
- Un seul magasin par partie (pas de réseau multi-magasins).
- Pas d'exécutable PC natif : le livrable PC est un build web (`dist/`). Sur Android, une APK est produite par GitHub Actions (non compilable dans l'environnement de développement, faute d'accès au SDK Android).
- L'APK est signée avec une clé de développement (pas une clé Play Store). Les performances sur un vrai téléphone n'ont pas pu être mesurées ici.

## Prochaines améliorations recommandées

1. Davantage de comportements de cambrioleurs (vitrine brisée, véhicule de fuite).
2. Vêtements et coiffures modélisés (proxies MakeHuman CC0 si le réseau permet de télécharger les packs d'assets), textures de peau, niveaux de détail pour les personnages éloignés.
3. Atlas de textures pour les étiquettes de prix (moins d'appels de rendu).
4. Second magasin / entrepôt (le format de sauvegarde le permet par migration).
5. Bâtiments neufs/rénovations visibles au-delà des façades (le quartier évolue déjà : les façades sont régénérées quand la prospérité change).
6. Contrôle manette.
7. Mesurer et optimiser le rendu sur téléphones d'entrée de gamme (niveau de détail, distance d'affichage).
