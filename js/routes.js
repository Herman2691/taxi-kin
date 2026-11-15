// Les trajets jouables. Toutes les positions sont en mètres réels le long de la chaussée
// (depuis le départ), tirées d'OpenStreetMap. Le trajet courant se choisit avec ?route=<id>.
//
// style : 'popular'    → quartiers populaires : accotements en terre, caniveaux, vendeurs partout
//         'monumental' → avenues rénovées : trottoirs dallés, grilles, bâtiments administratifs
//         'downtown'   → centre-ville de la Gombe : grands arbres, murs blancs, tours
// flyovers : sauts-de-mouton [s0, s1] en mètres réels (rampe des voies de gauche, routes à 4 voies)
/** s du trajet Route Poids Lourds à partir de la distance réelle depuis le boulevard Lumumba (plan OSM). */
const plKm = m => m - 1057;

export const ROUTES = {
  lumumba: {
    id: 'lumumba',
    title: 'Aéroport · Sendwe · Triomphal · 24 Novembre · Bd du 30 Juin',
    subtitle: "Aéroport → Sendwe → Triomphal → Libération (ex-24 Nov.) → Bd du 30 Juin (Kintambo ↔ Gare Centrale)",
    realKm: 27.5,
    data: 'data/lumumba.json',
    scale: 0.4,                   // 16,9 km réels → ~6,7 km de jeu (+ prolongement Sendwe → Triomphal → 24 Nov. → 30 Juin)
    lanes: 4,
    shiftSeconds: 960,            // 06:00 → 18:00 (480 s jusqu'à la 16e Rue ; allongé avec le tronçon 16e → 1re Rue, puis le prolongement)
    versement: 20000,
    fuelStart: 55,
    style: 'popular',
    intro: "06:00, aéroport de N'djili. Un voyageur attend devant : arrête-toi dans la zone jaune.",
    startAt: 'airport',
    start: 'airport',
    startSign: ['BOULEVARD LUMUMBA (RN1)', 'Masina · N\'djili Q1 · Pont Matete · Limete ↑'],
    // On traverse l'Échangeur (croquis de l'auteur), chaussées écartées autour du parc de la tour, puis le tronçon
    // de Limete jusqu'à la 1re Rue (croquis OSM « Bd Lumumba 16e–1re Rue », voir `limete`). trim négatif : l'arrivée
    // est au-delà de la fin du tracé OSM (la tour, 12 686 m) ; le tronçon après la tour est en ligne droite (comme
    // en vrai entre la 16e et la 1re Rue). La 1re Rue est la rue juste après HJ Hospitals et le pont sur la Yolo (l'auteur ;
    // « Avenue Saint Christophe » dans OSM, 17 172 m). Le trajet continue sous la passerelle jusqu'au croisement du
    // boulevard Sendwe (17 544 m, demande de l'auteur ; fork : boulevard Sendwe à gauche, boulevard Lumumba à droite, voir
    // limete.fork). Depuis le 31/10, le trajet continue à gauche par le boulevard Sendwe, le boulevard Triomphal et l'avenue
    // de la Libération (ex-24 Novembre) jusqu'au boulevard du 30 Juin (voir `ext`) : arrivée à l'Arrêt Mandela
    // (24 185 m), la chaussée continue `after` m de jeu, de l'autre côté du 30 Juin.
    end: { kind: 'tower', name: 'Boulevard du 30 Juin · Rond-point Mandela', short: 'Bd 30 Juin', trim: 0, after: 6, fork: true },   // (trim : calculé plus bas, voir `attach`)
    // Positions exactes en mètres le long du tracé réel (data/lumumba.json + OpenStreetMap) :
    // 0 m = Aérogare de N'djili → 3 418 m = Entrée Mikondo → 4 064 m = Station Total → 4 128 m = Entrée Siforco / Maman Mobutu →
    // 4 620 m = Kingasani → 5 280 m = Sans-Fil → 6 113 m = Pascal → 6 816 m = Entrée BKTF (Maison Communale Masina) →
    // 7 066 m = Pont Tshangu → 7 820 m = Liberté → 8 166 m = Bitabe → 9 035 m = Q1 Apocalypse →
    // 9 259 m = Ste-Thérèse → 9 490 m = Entrée Petro Congo → 9 834 m = Pont N'djili →
    // 10 420 m = Debonhomme → 11 496 m = Pont Matete → 12 686 m = Échangeur → 13 435 m = 16e Rue →
    // 15 736 m = 7e Rue / Avenue Yolo → 16 987 m = Pont Yolo → 17 042 m = HJ Hospitals → 17 172 m = 1re Rue →
    // 17 377 m = passerelle → 17 465 m = Église Saint Raphaël → 17 544 m = croisement du boulevard Sendwe (arrivée).
    landmarks: [
      ["Aéroport de N'djili", 'Aéroport', 0],
      ['Arrêt RVA (Zone Aéroport)', 'RVA', 1200, true],
      ['Arrêt Camp Badara', 'Camp Badara', 2350, true],
      ['Arrêt Badara (ITEC)', 'Badara', 3470, true],
      ['Entrée Mikondo', 'Mikondo', 3418],   // l'auteur : à gauche, entre la mosquée et l'École ITEC (plus d'entrée Nzoku)
      ['Arrêt Siforco · Entrée Maman Mobutu', 'Siforco', 4187, true],   // juste après l'Entrée Siforco (l'auteur)
      ['Arrêt Quartier 3 (Masina)', 'Quartier 3', 4910],
      ['Arrêt Bonamak (Shop Vodacom)', 'Bonamak', 5262, true],
      ['École Luka (Avant SDM Pascal)', 'École Luka', 5725, true],
      ['Place Pascal', 'Pascal', 6080],
      ['Arrêt BKTF · Maison Communale', 'BKTF', 6720, true],
      ['Arrêt Abattoir (Masina)', 'Abattoir', 7380, true],
      ['Marché de la Liberté', 'Liberté', 7820],
      ['Arrêt Bitabe (Hôpital Mutombo)', 'Bitabe', 8166, true],
      ['Entrée Kimbuta (Av. Elf)', 'Kimbuta', 8720, true],
      ["Quartier 1 (N'djili) · Apocalypse", 'Quartier 1', 8980],
      ['Arrêt Sainte-Thérèse', 'Ste-Thérèse', 9259, true],
      ['Arrêt Petro Congo (SEP Congo)', 'Petro Congo', 9640, true],
      ["Arrêt REGIDESO (Pont N'djili)", "Pont N'djili", 10075, true],
      ['Arrêt Debonhomme', 'Debonhomme', 10420],
      // en face de l'Entrée Matete (petit boulevard, à gauche au bout du saut-de-mouton de Debonhomme) : la Route Poids Lourds
      // part maintenant 100 m plus tôt et ne laisse plus la place à un arrêt avant elle (l'auteur, 31/10)
      ['Entrée Matete (Kinsaku)', 'Matete', 10860, true],
      ['Pont Matete · Poids Lourds', 'Pont Matete', 11496],
      ['Échangeur de Limete', 'Échangeur', 12686, true],
      // Tronçon de Limete (croquis OSM, distances depuis la 16e Rue + 13 435 m)
      ['16e Rue Limete', '16e Rue', 13435, true],
      ['Arrêt St. Joseph', 'St. Joseph', 13603, true],
      ['Arrêt 12e Rue', '12e Rue', 14760, true],
      ['Arrêt 8e Rue', '8e Rue', 15457, true],
      ['7e Rue · Avenue Yolo', '7e Rue', 15736],
      ['Arrêt 5e Rue', '5e Rue', 16225, true],
      ['Arrêt 2e Rue', '2e Rue', 16597, true],
      ['HJ Hospitals', 'HJ Hospitals', 17042, true],               // pas d'étiquette sur la barre : trop près de Sendwe
      ['1re Rue Limete', '1re Rue', 17172],
      ['Arrêt 1ère Rue (passerelle)', '1ère Rue', 17429, true],     // arrêt « Arrêt 1ère Rue » d'OSM, juste après la passerelle
      ['Église Saint Raphaël', 'St Raphaël', 17465, true],
      // Prolongement (l'auteur, 31/10 & 04/11 ; Google Maps dossier sendwe + OSM, distances depuis la fourche + 17 545 m, voir `ext`)
      ['Croisement Sendwe (Station Cohydro)', 'Sendwe', 17545],
      ['Kin Marché · ISS Kin (Sendwe)', 'Kin Marché', 17960, true],
      ['Stade Tata Raphaël', 'Tata Raphaël', 18000, true],
      ['Av. du Peuple (Luambo Makiadi)', 'Luambo', 18185, true],
      ['Pont Rivière Funa · Permanence', 'Pont Funa', 18300, true],
      ['Hôtel Sendwe · Pont Cabu', 'Pont Cabu', 18765, true],
      ['Croisement Kasa-Vubu (Robot Pont-Cabu)', 'Kasa-Vubu', 18995],
      ['Stade des Martyrs · Kinshasa Arena', 'Martyrs', 19295],
      ['Lycée Madame de Sévigné · SNEL', 'Sévigné', 19725, true],
      ['Avenue des Huileries (Robot roulage)', 'Huileries', 19945, true],
      ['Palais du Peuple · Musée International', 'Palais', 20265],
      ['Musée national (MNRDC) · PNMLS', 'Musée', 20800, true],
      ['Av. de la Libération (Camp Kokolo)', '24 Novembre', 21200],
      ['Cathédrale du Centenaire · Rawbank UPC', 'Centenaire', 21370, true],
      ['Université protestante (UPC)', 'UPC', 21615, true],
      ['RTNC · Centre Sportif de Judo', 'RTNC', 21855],
      ['Arrêt Asanef (Saut-de-mouton 24 Nov.)', 'Asanef', 22245],
      ['Université Révérend Kim · CENCO', 'Rév. Kim', 22405, true],
      ['Cathédrale Notre-Dame du Congo', 'Notre-Dame', 22635],
      ['Académie des Beaux-Arts · ISAU', 'Beaux-Arts', 23134, true],
      ['Pont Rivière Gombe · Mont des Arts', 'Pont Gombe', 23460, true],
      ['Kinshasa Mall', 'Mall', 23625],
      ['Institut Supérieur de Commerce · Aurora', 'ISC', 23935, true],
      ['Ambassade de Belgique', 'Ambassades', 24156, true],
    ],
    rivers: [
      ['Rivière Tshenke', 2655, 14, 'PONT TSHENKE'],
      ['Rivière Bonamak', 5345, 14, 'PONT BONAMAK'],
      ['Rivière Tshangu', 7066, 16, 'PONT MAYI YA TSHANGU'],
      ["Rivière N'djili", 9834, 46, "PONT MAYI YA N'DJILI"],
      ['Rivière Yolo', 16987, 12, 'PONT YOLO'],                 // Limete : sous les deux chaussées et les deux petits boulevards (OSM)
      ['Rivière Funa', 18300, 14, 'PONT RIVIÈRE FUNA'],         // Bd Sendwe (~755 m) : entre Av. du Peuple et Bd Permanence
      ['Rivière Cabu (Ngabi)', 18900, 12, 'PONT CABU · NGABI'], // Bd Sendwe (~1 355 m) : après Rue de Gombari, avant Kasa-Vubu
      ['Rivière Gombe', 23460, 14, 'PONT RIVIÈRE GOMBE'],       // Av. du 24 Novembre (~5 915 m) : avant Av. de la Gombe / Mont des Arts
    ],                            // le Pont Matete enjambe le chemin de fer, pas une rivière (voir places : pont_matete)
    // Sauts-de-mouton : les 2 voies de gauche montent sur la rampe, les 2 de droite restent en bas (marché, clients)
    flyovers: [
      { name: 'Pascal', s0: 5812, s1: 6350, title: 'SAUT-DE-MOUTON PASCAL', sub: 'Gauche : direct Limete · Droite : Arrêt Pascal' },
      { name: 'Bitabe', s0: 7792, s1: 8251, title: 'SAUT-DE-MOUTON BITABE', sub: 'Gauche : direct Q1 · Droite : Marché de la Liberté · Bitabe' },
      { name: 'Debonhomme', s0: 10319, s1: 10806, title: 'SAUT-DE-MOUTON DEBONHOMME', sub: 'Gauche : direct Limete · Droite : Arrêt Debonhomme' },
      // Avenue de la Libération (l'auteur : « dans l'Arrêt ASSANEF » ; pas dans OSM) : les voies du centre montent juste
      // après la station Elf, passent au-dessus des avenues Kabinda et Sergent Moke / Nyangwe et redescendent avant
      // l'Université Révérend Kim (vidéos Route24 : « GOMBE/LINGWALA… » 1:48–2:42, « Saute de mouton 24 Novembre… »)
      { name: 'Asanef', s0: 21995, s1: 22405, title: 'SAUT-DE-MOUTON ASANEF', sub: 'Gauche : direct Gombe · Droite : Arrêt Asanef', look: 'asanef' },
    ],
    // + passerelles de Limete : P1 (13e Rue), P2 (entre la 8e et la 7e Rue), P3 (après la 1re Rue, avant Saint Raphaël)
    footbridges: [6513, 7690, 14430, 15662, 17377],
    // Chaque arrêt correspond exactement à un repère de `landmarks` (dégagé des rivières, stations et entrées de rues)
    busStops: [
      1200, 2350, 3470, 4187,                 // (l'arrêt Badara ITEC sert aussi l'Entrée Mikondo, juste avant) 4910, 5262, 6080, 6720, 7380,
      7820, 8166, 8720, 8980, 9259, 9640, 10075, 10420, 10860,   // (Entrée Matete (Kinsaku) : 10 860, en face de l'Entrée Matete)
      13603, 14760, 15457, 16225, 16597,      // Limete, côté droit (St. Joseph, 12e, 8e, 5e, 2e Rue)
      17429,                                  // Arrêt 1ère Rue, juste après la passerelle (OSM)
      17960, 18185, 18765,                    // Bd Sendwe : Kin Marché / ISS Kin, Av. du Peuple (Luambo), Hôtel Sendwe / Pont Cabu
      19295, 19725, 20265, 20800,             // Bd Triomphal : Stade des Martyrs, Sévigné, Palais du Peuple / Musée International, MNRDC / PNMLS
      21200, 21855, 22245, 23625, 23935,      // Libération : Kokolo, RTNC / Judo, Asanef (sous le saut-de-mouton), Kinshasa Mall, ISC / Aurora
    ],
    stations: [
      // Station Cobil juste avant l'Entrée Siforco, jusqu'à l'entrée (l'auteur ; vidéo Kulumba 43:52 : boutique bleue « cobil »,
      // auvent blanc à liseré rouge et totem bleu « COBIL ») ; la Station ML un peu plus loin, après l'arrêt Siforco (4 260 m)
      ['Station Cobil', 4064],
      ['Station ML', 4260],
      ['Station Engen', 4338],
      ['Station', 4715],
      ['Station ML', 4825],
      ['Station Engen', 5070],
      ['Station Liberté (Fina)', 7563],
      ['Station Salongo', 10937],
      ['Station Sonap', 14556, 'strip'],        // Limete : dans la bande entre la chaussée et le petit boulevard
      ['Station Cohydro', 17730, 'fork'],       // dans la pointe de la fourche Sendwe (voir addSendweFork)
      ['Station Elf', 22105],                   // Libération, au pied du saut-de-mouton d'Asanef (OSM 22 105 m)
    ],
    crossings: [],
    greenMedianUntil: null,
    highwayUntil: 'Badara',       // de l'aéroport à Badara (3,47 km) : route large RN1 le long du périmètre aéroportuaire
    barrierLen: 6,                // longs blocs béton DBA rouges et blancs (comme sur les photos et vidéos)
    guardrails: [['Quartier 3', 260]],
    dense: [['Liberté', 160], ['Pascal', 90], ['Quartier 3', 160], ['Quartier 1', 110], ['Pont Matete', 85]],
    // Foule (l'auteur, 07/11) : beaucoup de piétons, des gens qui traversent le boulevard, des clients qui se précipitent vers les taxis [début, fin (m), nom]
    crowds: [[4000, 7000, 'Siforco · Kingasani · Masina · Pascal · BKTF'], [7300, 8300, 'Bitabe · Liberté'], [8650, 9320, 'Quartier 1']],
    // Embouteillages (l'auteur, 08/11 : « surtout sur 24, 30 Juin et boulevard Lumumba de Bitabe au Quartier 1 ») [début, fin (m réels), force]
    jams: [[8100, 9050, 1], [14300, 14600, 1], [15560, 15860, 1], [21089, 24185, 1]],   // Bitabe → Quartier 1 ; Limete 13e Rue et 7e Rue (l'auteur, 10/11) ; avenue de la Libération (ex-24 Novembre) → Mandela
    // (l'auteur, 10/11) bagarres de Kuluna qui bloquent la route : Masina Quartier 3 et Kingasani ya Suka ; vols à moto : Pascal (et la Place Victoire, Kasa-Vubu)
    kuluna: [[4250, 5150]],
    thefts: [[5850, 6450]],
    market: { at: 'Liberté', title: 'MARCHÉ DE LA LIBERTÉ', sub: 'Commune de Masina · Tshangu' },
    busParks: ['Pascal', 'Quartier 1'],
    tallNearEnd: 1200,
    cranes: true,
    monuments: [],
    workers: [6080, 8920],
    // Repères réels d'après TPF / FIchierGAMA (OpenStreetMap), photos et vidéos (côté 1 = droite en partant de l'aéroport, -1 = gauche)
    places: [
      { kind: 'tanks', s: 440, side: 1 },
      // Badara (l'auteur, 30/10), tout du côté d'ITEC (à gauche) : la mosquée, 30 m après l'Entrée Mikondo, 30 m après l'École
      // ITEC et, juste après, l'Église de Jésus-Christ des Saints des Derniers Jours
      { kind: 'mosque', name: 'MOSQUÉE', sub: 'Badara', s: 3368, side: -1 },
      { kind: 'school', name: 'ÉCOLE ITEC KINSHASA', sub: 'Institut Technique · Badara', s: 3471, side: -1 },
      { kind: 'lds_church', s: 3560, side: -1 },                    // Église des Saints des Derniers Jours (à gauche, juste après ITEC)
      { kind: 'kimbanseke_commune', s: 4338, side: -1 },            // Maison Communale de Kimbanseke (à gauche, en face de la 1re Station Engen)
      { kind: 'lds_church', s: 4600, side: 1 },                     // Église des Saints des Derniers Jours (à droite, 80 m après la 1re Station Engen)
      { kind: 'fuel', name: 'STATION ENGEN', s: 5070, side: -1 },   // Station Engen à gauche, juste en face de la Station Engen de droite (après Arrêt Quartier 3)
      { kind: 'kinmarche', s: 5142, side: -1 },                     // Kin Marché à gauche, à 5 m après la Station Engen de gauche
      { kind: 'vodacom_shop', s: 5262, side: -1 },                  // Shop Vodacom à gauche, dans l'Arrêt Bonamak (30 m après Kin Marché)
      { kind: 'orange_shop', s: 5460, side: 1 },                    // Shop d'Orange à 2 niveaux à droite (30 m après le Pont Bonamak)
      { kind: 'mbujimayi_kananga', s: 5585, side: 1 },              // Immeuble de 3 niveaux « Mbujimayi Kananga » à droite (30 m après Shop Orange)
      { kind: 'ecole_luka', s: 5725, side: 1 },                     // École LUKA à droite (30 m après Mbujimayi Kananga et 20 m avant SDM Pascal)
      { kind: 'stade_masina', s: 6687, side: 1, length: 38 },       // Stade Municipal de Masina : jusqu'à l'entrée BKTF (l'auteur ; OSM 6 638–6 742 m)
      { kind: 'masina_commune', s: 6816, side: 1 },                 // Maison Communale de Masina juste après l'entrée BKTF (OSM 6 816 m)
      { kind: 'church', name: 'ÉGLISE SAINTE-FAMILLE', sub: 'Paroisse Catholique · Masina', s: 7623, side: -1 },
      { kind: 'hospital', name: 'HÔPITAL BIAMBA MUTOMBO', sub: 'Fondation Dikembe Mutombo · Bitabe', s: 8128, side: 1 },   // (l'auteur, 13/11 : à droite, côté Masina)
      { kind: 'commercial', name: 'HÔTEL OCÉAN', sub: 'Hôtel · Restaurant · Bitabe', color: '#0b5d8f', s: 8220, side: -1 },
      { kind: 'commercial', name: 'RAWBANK BITABE', sub: 'Agence & Distributeur ATM 24h/24', color: '#1a1a1a', fg: '#f5c400', s: 8334, side: -1 },
      // Kimbuta (l'auteur, OSM) : l'immeuble de l'hôpital et de la salle de fête, puis le shop Airtel juste avant l'entrée ;
      // l'Université Révérend Kim sur le Bd Kimbuta, juste derrière la station (OSM 8 747–8 786 m, 117–181 m du boulevard) ;
      // en face, côté Masina, la Mosquée Atwa (OSM 8 711 m)
      { kind: 'commercial', name: 'HÔPITAL · SALLE DE FÊTE', sub: 'Kimbuta', color: '#0a4fa3', s: 8690, side: -1 },
      { kind: 'airtel_shop', s: 8742, side: -1 },
      { kind: 'mosque', name: 'MOSQUÉE ATWA', sub: 'Kimbuta · Masina', s: 8715, side: 1 },
      { kind: 'school', name: 'UNIVERSITÉ RÉVÉREND KIM', sub: 'Campus de N\'djili · Bd Kimbuta', s: 8830, side: -1, back: 32 },
      { kind: 'fuel', name: 'TOTALENERGIES', s: 8835, side: -1 },   // TotalEnergies près de l'entrée Kimbuta (TPF gis_osm_traffic s=8810)
      { kind: 'kinmarche', s: 9035, side: 1 },                      // Kin Plaza & Kin Marché + immeuble en briques rouges à arche au Quartier 1
      { kind: 'apocalypse', s: 9095, side: 1 },                     // Ensemble Quartier 1 : Apocalypse 22 + Ecobank + Super Tex + National
      { kind: 'fuel', name: 'STATION ML', s: 9300, side: -1 },      // ML Station Services (TPF gis_osm_buildings s=9317)
      // Première Entrée de N'djili (l'auteur ; « Route Mama Mobutu » dans OSM, 9 367 m) : la TMB juste après, à gauche
      // (OSM 9 391 m), le Food Market en face, côté Masina (OSM 9 354 m)
      { kind: 'commercial', name: 'FOOD MARKET', sub: 'Supermarché', color: '#2e7d32', s: 9350, side: 1 },
      { kind: 'commercial', name: 'EQUITY BCDC · BOA', sub: 'Bank of Africa · Equity Bank', color: '#8b1d24', fg: '#f5c400', s: 9395, side: 1 },
      { kind: 'commercial', name: 'BANQUE TMB N\'DJILI', sub: 'Trust Merchant Bank · Place Commerciale', color: '#c8102e', fg: '#ffffff', s: 9400, side: -1 },
      // Mega Mart, supermarché à 2 niveaux juste à l'Entrée Petro Congo, avant elle en venant de l'aéroport (l'auteur)
      { kind: 'commercial', name: 'MEGA MART', sub: 'Supermarché', color: '#e65100', s: 9458, side: 1, h: 7.4 },
      { kind: 'petro', s: 9555, side: 1 },                          // SEP Congo / Petro Congo juste à l'Entrée Petro Congo avant le Pont N'djili
      { kind: 'regideso', s: 9940, side: 1 },                       // Usine REGIDESO N'djili à droite, immédiatement à la sortie du Pont Mayi ya N'djili
      { kind: 'commercial', name: 'SIÈGE PNC · KIN MOTOS TVS', sub: 'Police Nationale Congolaise · TVS', color: '#1d4fa0', fg: '#f5c400', s: 10380, side: -1 },
      { kind: 'school', name: 'C.S. LE BAMBINO', sub: 'Complexe Scolaire · Debonhomme', s: 10544, side: 1 },
      // Rawbank : « juste une petite agence attachée à la station, un distributeur avec quelques places assises ; le macadam
      // passe derrière » (l'auteur, 31/10) : kiosque collé à la Station ENGEN, côté aéroport, devant le petit boulevard
      { kind: 'atm', name: 'RAWBANK', sub: 'Distributeur · Agence', s: 10845, side: -1 },
      // Station ENGEN après SDM Debonhomme (TPF gis_osm_buildings s=10856) ; un peu reculée vers Limete pour que le petit
      // boulevard de l'Entrée Matete parte avant elle et passe derrière (l'auteur, 31/10)
      { kind: 'fuel', name: 'STATION ENGEN', s: 10885, side: -1 },
      // (l'auteur, 10/11 : « mettre une station à droite, 10 m avant le saut-de-mouton de Debonhomme ») : OSM a bien une station sans nom
      // à 10 269 m, côté Salongo (data/lumumba.json) ; posée juste avant le début de la rampe (10 319 m). Nom à confirmer par l'auteur.
      { kind: 'fuel', name: 'STATION DEBONHOMME', s: 10290, side: 1 },
      { kind: 'hospital', name: 'HÔPITAL TELEMA', sub: 'Centre Hospitalier de Matete', s: 11140, side: -1 },
      { kind: 'pont_matete', s: 11496, side: 1 },                   // Remblai + pont sur le chemin de fer et la Route Poids Lourds (Hôpital Akram), 2e pont sur les petits boulevards (Transco, Collège Lumumba)
    ],
    // Carrefour à robot roulage (l'auteur, 10/11 : « mettre un robot roulage entre l'entrée Kimbuta et la mosquée, enlever les bordures
    // là-bas pour permettre au véhicule de tourner ») : le terre-plein s'ouvre sur w m à l'Entrée Kimbuta, le robot se tient au bout du
    // terre-plein côté Mosquée Atwa et règle la circulation comme un feu (world.js SIGNALS) ; on tourne vers Kimbuta depuis les deux chaussées.
    signals: [{ s: 8775, w: 22, robot: true }],
    // (l'auteur, 13/11 : « enlève le séparateur au niveau de l'entrée de Siforco ») : terre-plein ouvert sur w m devant l'Entrée Siforco et
    // l'Entrée Maman Mobutu, en face : plus de séparateur ni de bordures, on tourne et on traverse depuis les deux chaussées
    // (l'auteur, 14/11 : « il faut enlever le séparateur à l'Entrée Moboma, et aussi devant l'église des Saints des Derniers Jours de Masina ») :
    // [s (m réels), largeur de l'ouverture (m de jeu)]
    medianCuts: [[4128, 26], [4600, 20], [4905, 26]],
    // (l'auteur, 13/11 : « ajouter aussi des travaux dans le boulevard » ; 14/11 : « le chantier ne doit pas être à chaque course, c'est aléatoire ») :
    // les endroits possibles [début, fin (m réels), chaussée (1 : vers Limete, -1 : vers l'aéroport), voies fermées (0 : près du terre-plein … 3 : au
    // bord)], loin des ponts, des arrêts, des entrées et des sauts-de-mouton ; chaque journée en tire au hasard aucun, un ou deux (world.js randomizeWorks)
    works: [[1680, 1880, 1, [2, 3]], [7120, 7280, -1, [2, 3]], [8450, 8640, 1, [2, 3]], [10990, 11180, -1, [0, 1]], [12200, 12380, -1, [2, 3]], [15250, 15440, 1, [2, 3]]],
    // Boulevards et avenues d'entrée positionnés selon TPF/FIchierGAMA/roadskin.shp et vos repères exacts
    sideRoads: [
      // (pas d'entrée Nzoku : l'Entrée Mikondo est à gauche, 30 m après la mosquée et 30 m avant l'École ITEC — l'auteur)
      { s: 3418, side: -1, name: 'ENTRÉE MIKONDO', sub: 'Commune de Kimbanseke' },
      // masina : entrée de la boucle de Masina (voir `masina` plus bas), la route continue jusqu'à l'Avenue Kulumba
      { s: 4128, side: 1, name: 'ENTRÉE SIFORCO', sub: 'Masina Siforco · Av. Bosango', triangle: true, masina: 'bosango' },
      // (l'auteur, 14/11 : « nous avons déjà l'Entrée Mobutu, déjà liée au boulevard ; il faut juste continuer avec l'avenue Mobutu ») : l'entrée continue
      // dans la Rue Kabila (ex Mobutu) du quartier de Moboma (voir `moboma`, joinAt)
      { s: 4128, side: -1, name: 'ENTRÉE MAMAN MOBUTU', sub: 'En face Entrée Siforco · Marché Kabila', link: 'moboma', moboma: 'kabila' },
      // Kingasani, l'Entrée Moboma (l'auteur, 14/11 : croquis Kingasani/carte_corrigee.png et vidéos) : les rues du quartier (voir `moboma`) qui
      // arrivent sur le boulevard, à leur vraie place et dans leur vrai biais (OSM, tools/moboma_osm.py) ; link : seulement l'embouchure, la rue
      // est construite par world.js (addMoboma) ; noGap : le terre-plein reste fermé en face (seule l'Entrée Moboma a son ouverture)
      { s: 4499, side: -1, name: 'RUE MA SŒUR', sub: 'Kingasani · Centre de santé Ma Sœur', ang: 29, w: 8.5, link: 'moboma', moboma: 'masoeur', noGap: true },
      // (l'auteur, 14/11) ces deux rues n'ont pas de nom : « la direction qui commence au centre pastoral » et « celle qui commence à Saint-Marc »,
      // goudronnées de Moboma jusqu'à Kimpioka, en terre à gauche de Moboma, jusqu'au boulevard
      { s: 4638.5, side: -1, name: 'DIRECTION CENTRE PASTORAL', sub: 'Centre hospitalier · Rue Kimpioka', ang: 34, w: 8, link: 'moboma', moboma: 'milieu', noGap: true },
      { s: 4764, side: -1, name: 'DIRECTION SAINT-MARC', sub: 'Paroisse Saint-Marc · ITP Passio', ang: 33, w: 8.5, link: 'moboma', moboma: 'bas', noGap: true },
      // (l'auteur, 14/11 : « l'avenue Moboma doit venir avant Twana, bien qu'elle soit du côté Kingasani ») : 40 m avant l'Avenue Twana ; la rue rejoint
      // son vrai tracé au carrefour du macadam de Saint-Marc
      { s: 4905, side: -1, name: 'ENTRÉE MOBOMA', sub: 'Avenue Moboma · Aéro Club · Kingasani', ang: -46, link: 'moboma', moboma: 'moboma' },
      { s: 5020, side: -1, name: 'AVENUE MASWA', sub: 'Kingasani', ang: -55, w: 6, link: 'moboma', moboma: 'maswa', noGap: true },
      // (l'auteur, 14/11 : « la Rue de la Commune sort aussi sur le boulevard, à l'entrée de la Maison communale ») : juste après la Maison communale
      // de Kimbanseke, côté Limete (elle ne peut pas traverser le bâtiment)
      { s: 4386, side: -1, name: 'RUE DE LA COMMUNE', sub: 'Maison communale de Kimbanseke', ang: 30, w: 7, link: 'moboma', moboma: 'commune', noGap: true },
      // Avenue Twana (« Tuana » dans OSM) : la seule avenue de quartier ouverte sur le boulevard (l'auteur, 30/10)
      // (l'auteur, 14/11 : « l'avenue Twana, à l'arrêt Quartier 3 de Masina, vient avant la station Engen, pas après ») : juste après l'arrêt Quartier 3
      // (OSM la met à 5 176 m, mais la station Engen y est après le pont Bonamak ; la suite de repères de l'auteur est gardée)
      { s: 4945, side: 1, name: 'AVENUE TWANA', sub: 'Masina · Vers Av. Kulumba', masina: 'twana' },
      { s: 6060, side: -1, name: 'ROUTE DE MOKALI', sub: 'Sous SDM Pascal' },
      { s: 6493, side: -1, name: 'AVENUE DU MARCHÉ', sub: 'Masina Pascal' },
      // la vraie route de BKTF (OSM 6 749 m, entre l'arrêt BKTF et la Maison Communale ; avant : 6 816 m), validée par l'auteur
      { s: 6749, side: 1, name: 'ENTRÉE BKTF (PASCAL)', sub: 'Commune de Masina · Maison Communale', masina: 'bktf' },
      // (l'auteur, 30/10 : plus d'Av. Force Nationale, ni d'Avenue Abattoir après la Rawbank, ni d'Avenue Mobutu après la
      // Première Entrée de N'djili)
      // sous le saut-de-mouton de Bitabe, à droite : l'Avenue Bolenge (l'auteur, 31/10 ; OSM 7 994 m, en biais de 21° vers
      // Limete), vers le Centre hospitalier Roi Baudouin ; elle ferme le Marché de la Liberté côté Limete
      { s: 7994, side: 1, name: 'AVENUE BOLENGE', sub: 'Masina · Hôpital Roi Baudouin', ang: 21 },
      { s: 8775, side: -1, name: 'BD KIMBUTA (AV. ELF)', sub: "Univ. Rév. Kim · N'djili" },
      { s: 9366, side: -1, name: 'PREMIÈRE ENTRÉE', sub: "N'djili · Cecomaf · Rocade", mm: true },   // nom donné par l'auteur (« Route Mama Mobutu » dans OSM) ; mm : la vraie route (ROAD8) quand elle est chargée
      { s: 9490, side: 1, name: 'ENTRÉE PETRO CONGO', sub: 'SEP Congo · Masina' },
      { s: 10581, side: -1, name: 'AV. KIMIALA (LUMIÈRE)', sub: 'Sous SDM Debonhomme' },
      { s: 10803, side: 1, name: 'AV. DE LA RÉVOLUTION', sub: 'Limete Salongo' },
      // Entrée Matete (croquis de l'auteur, 31/10 ; OSM 10 711 m) : à gauche, « 2 m après le début du saut-de-mouton » de
      // Debonhomme et avant la Station ENGEN, en biais vers l'avant. C'est là que partait l'Av. de la Révolution de gauche : elle
      // devient ce petit boulevard (le panneau garde son nom). link : seule l'embouchure est ici, le petit boulevard qui passe
      // derrière la station et rejoint la Route Poids Lourds côté Matete est construit par world.js (MAT_PB)
      { s: 10802, side: -1, name: 'ENTRÉE MATETE', sub: 'Av. de la Révolution · Poids Lourds', ang: 30, link: 'matete' },
      // (après la tour, la route venant de la gauche passe en pont au-dessus de la chaussée de gauche : voir addInterchange)
      { s: 13435, side: 1, name: '16e RUE LIMETE', sub: "Après l'Échangeur · Limete" },   // là où les chaussées se rejoignent (terre-plein ouvert)
      // (la 17e Rue part du petit boulevard de droite, au coin du Collège Lumumba : voir addInterchange)
    ],
    // Boucle de Masina (croquis « Boucle de Masina » d'après OSM, validé par l'auteur le 30/10) : Entrée Siforco → Avenue
    // Bosango → Avenue Kulumba, parallèle au boulevard → route de BKTF → boulevard. L'Avenue Bosango continue jusqu'à SOCIDER
    // (au bout, près du chemin de fer), la route de BKTF jusqu'à la rue Imbali, le long du chemin de fer (l'auteur).
    // Le tracé est celui d'OSM (osm : tools/masina_osm.py), à la même échelle que le boulevard dans les deux directions :
    // l'auteur a demandé de « rétablir la distance » (Kulumba était rapprochée du boulevard). s : m réels depuis l'aéroport.
    // streets : avenues qui croisent Kulumba (OSM), côté 'b' (vers le boulevard) et/ou 'i' (vers l'intérieur), dans leur vraie
    // direction ; elles n'ont pas d'accès au boulevard (l'auteur). Les rues décalées d'un côté à l'autre gardent leurs deux
    // carrefours (Maman Yemo, Congo). 4e valeur : le nom d'OSM quand l'auteur en donne un autre (Bikotikala, « Revolution »
    // sur la carte : elle part de Kulumba à droite juste après Sukambundu et descend vers le chemin de fer).
    // landmarks (l'auteur, 30/10) : la petite école à gauche après l'Avenue Congo, la salle de fête à droite après
    // Sukambundu, le bâtiment commercial des Chinois à droite, de Bikotikala jusqu'à Mayamba ; les autres repères (Marché Hindou, Terrain
    // Sademi 1, pharmacie, station Total, pont du Quartier 3 au Quartier 2) sont placés d'après leur route (world.js addMasina).
    // Kingasani, l'Entrée Moboma (l'auteur, 14/11 : « on va créer cette entrée de Moboma », croquis carte_corrigee.png, vidéos du dossier
    // Kingasani) : le vrai tracé d'OSM (data/moboma_osm.json, tools/moboma_osm.py) à l'échelle du boulevard, comme Masina. roads : [clé, nom
    // (vide : rue sans nom), goudronnée (MACADAM du croquis) ou en terre (AVENUE), largeur (m)] ; front : tranche du boulevard (m réels) dont
    // le quartier construit lui-même les façades (ses rues y passent en biais). Les entrées sur le boulevard sont dans sideRoads (moboma : clé).
    moboma: {
      osm: 'data/moboma_osm.json',
      front: [4128, 5040],
      // le Lycée de Kingasani 2 et l'E.P. Elikya : une allée de len m qui prolonge la Rue de la Commune au-delà de la Rue Kimpioka (world.js addLycee)
      lycee: { len: 82.5, w: 7.5 },
      roads: [
        ['moboma', 'AVENUE MOBOMA', true, 9], ['kimpioka', 'RUE KIMPIOKA', true, 8.5], ['kimpioka_bas', 'RUE KIMPIOKA', true, 8],
        // split : la rue est coupée à la traversée de Moboma, goudronnée après, en terre avant (côté boulevard) ; label : nom affiché en roulant
        ['bas', 'MACADAM DE SAINT-MARC', true, 8.5, { split: 'moboma', west: 'DIRECTION SAINT-MARC', label: 'Macadam de Saint-Marc', westLabel: 'Direction Saint-Marc', plate: false }],
        ['milieu', 'MACADAM DU CENTRE PASTORAL', true, 8, { split: 'moboma', west: 'DIRECTION CENTRE PASTORAL', label: 'Macadam du centre pastoral', westLabel: 'Direction centre pastoral', plate: false }],
        ['masoeur', 'RUE MA SŒUR', true, 8.5], ['commune', 'RUE DE LA COMMUNE', false, 7],
        ['kabila', 'RUE KABILA (EX MOBUTU)', true, 9, { joinAt: 62, straight: 11 }], ['maswa', 'AVENUE MASWA', false, 6], ['ndona', 'AVENUE NDONA', false, 6],
        ['g1', '', false, 6], ['mayulu', 'AVENUE MAYULU', false, 6], ['ngangwele', 'AVENUE NGANGWELE', false, 6],
      ],
    },
    masina: {
      osm: 'data/masina_osm.json',
      kulumbaEnd: 7005,                        // jusqu'après Baramoto (Kulumba continue en vrai vers Tshangu)
      imbali: [6615, 6890],                    // morceau de la rue Imbali construit, le long du chemin de fer
      socider: ['SOCIDER', 'Société Sidérurgique de Masina'],
      landmarks: { school: 4833, partyHall: 5238, chinese: [5291, 5337] },
      streets: [
        [4500, 'BUMBA', 'i'], [4517, 'MAMAN YEMO', 'b'], [4528, 'MAMAN YEMO', 'i'], [4569, 'ECOLE', 'bi'], [4612, 'EBEYA', 'bi'],
        [4678, 'EKILA', 'bi'], [4740, 'CONGO', 'i'], [4804, 'CONGO', 'b'], [4862, 'KAMBA', 'b'], [4882, '', 'i'],
        [4920, 'KUTIKA', 'b'], [4946, '', 'i'], [4990, 'KINGUENDI', 'b'], [5021, '', 'i'], [5035, 'LOSO', 'b'],
        [5083, 'KIALA', 'bi'], [5127, 'MUKUKULU', 'bi'], [5195, '', 'i'], [5238, 'SUKAMBUNDU', 'bi'], [5291, 'BIKOTIKALA', 'i', 'Revolution'],
        [5337, 'MAYAMBA', 'bi'], [5393, 'LUNDA', 'bi'], [5427, 'LOA', 'bi'], [5486, 'MUTANGI', 'bi'], [5529, 'MABAKA', 'bi'],
        [5575, 'KADANGA', 'bi'], [5618, 'KIMBELA', 'bi'], [5654, 'MUKILA', 'bi'], [5699, 'MABWIDI', 'bi'],
        [5744, 'TABLE RONDE', 'bi'], [5801, 'MBANZA', 'bi'], [5853, '', 'bi'], [5883, '', 'bi'], [5912, 'KIBUNDA', 'bi'],
        [5957, '', 'bi'], [6176, 'MAKULUNGULU', 'b'], [6271, 'NZITA PUATI', 'bi'], [6367, 'KABAIDI WA KABAIDI', 'bi'],
        [6496, 'DU MARCHÉ', 'bi'], [6640, 'PELENDE', 'bi'], [6972, 'BARAMOTO', 'bi'],
      ],
    },
    // Grands panneaux publicitaires avec une photo (dossier « pano publicitaire ») : s, côté, image, largeur (m)
    photoBoards: [
      { s: 13402, side: 1, img: 'data/tex/pubs/jesus_revient.jpg', w: 9.6 },   // « Jésus revient », à l'entrée de la 16e Rue, côté industriel
    ],
    // Tronçon 16e Rue → 1re Rue (croquis OSM « Bd Lumumba 16e–1re Rue », TPF/FIchierGAMA/roadskin.shp).
    // s = mètres réels depuis l'aéroport (16e Rue = 13 435 m + distance du croquis) ; n = numéro sur le croquis.
    // Deux petits boulevards à double sens sur toute la longueur : Industriel à droite, Résidentiel à gauche.
    // from : 'pb' = la rue part du petit boulevard ; 'road' = elle part de la chaussée et traverse la bande jusqu'au
    //        petit boulevard (s2 = point où elle le touche quand elle traverse en biais) ; 'service' = petit accès.
    // len = longueur dessinée au-delà du petit boulevard (m de jeu) ; ang = biais au-delà (degrés, + vers l'avant).
    // oneway (rues 'road') : 'out' = sens unique vers le boulevard (on en sort seulement), 'in' = depuis le boulevard
    // (on y entre seulement) ; lawnBefore = pelouse sur toute la bande entre cette rue et la précédente.
    limete: {
      from: 13435,
      buildings: 'data/limete_osm.json',     // bâtiments réels (OSM) derrière les petits boulevards : tools/limete_buildings.py
      streets: [
        { n: 2, s: 13580, side: 1, from: 'service', len: 20 },
        { n: 3, s: 13650, side: 1, from: 'service', len: 18 },
        { n: 5, s: 13835, side: 1, from: 'pb', name: '15e RUE', ang: -20, len: 90 },
        { n: 6, s: 13912, side: 1, from: 'service', len: 26 },
        { n: 7, s: 13962, side: -1, from: 'service', len: 22 },
        { n: 8, s: 13980, side: 1, from: 'pb', len: 45 },
        { n: 9, s: 14098, side: 1, from: 'road', name: '14e RUE', len: 90 },
        { n: 9, s: 14098, side: -1, from: 'road', len: 0 },
        { n: 11, s: 14375, side: -1, from: 'pb', name: '13e RUE', len: 90 },              // « 13 Rue » dans OSM
        // Côté industriel, les 13e, 10e, 9e et 8e Rues s'arrêtent au petit boulevard, sans accès au grand boulevard
        // (demande de l'auteur) : plus de bretelle n° 13 vers la chaussée
        { n: 12, s: 14426, side: 1, from: 'pb', name: '13e RUE', len: 90 },
        { n: 14, s: 14597, side: 1, from: 'pb', len: 50 },
        { n: 15, s: 14609, side: -1, from: 'pb', name: 'AV. DE LA POSTE', len: 80 },
        { n: 16, s: 14674, s2: 14760, side: -1, from: 'road', ang: 15, len: 90 },          // sans nom, vers l'Av. du Lac
        { n: 17, s: 14757, side: 1, from: 'pb', name: '12e RUE', len: 90 },
        { n: 18, s: 14965, side: -1, from: 'pb', name: 'RUE BÉGONIAS', ang: 8, len: 80 },
        { n: 19, s: 15010, side: 1, from: 'road', name: '11e RUE', len: 60 },
        { n: 20, s: 15164, side: 1, from: 'pb', name: '10e RUE', len: 90 },
        { n: 21, s: 15182, side: -1, from: 'road', name: 'ZINNIAS', sub: 'Rond-point · Limete Résidentiel', w: 12, len: 58, roundabout: true },
        { n: 22, s: 15355, side: 1, from: 'pb', name: '9e RUE', len: 90 },
        { n: 23, s: 15514, side: -1, from: 'service', len: 26 },
        { n: 24, s: 15546, side: 1, from: 'pb', name: '8e RUE', len: 90 },
        { n: 27, s: 15708, side: -1, from: 'pb', name: 'IXHORAS AVENUE', ang: 17, len: 95 },
        { n: 28, s: 15736, side: 1, from: 'road', name: '7e RUE', len: 90 },
        // 7e Rue côté résidentiel, deux entrées à sens unique (croquis de l'auteur « deux entrer 7ieme ») : on sort du
        // quartier par l'Avenue Yolo pour entrer sur le boulevard ; on quitte le boulevard par la 2e route, droite comme sur
        // le croquis, à 40 m de jeu de l'Avenue Yolo, après une pelouse (terre-plein ouvert, sans feu)
        { n: 28, s: 15739, s2: 15758, side: -1, from: 'road', name: 'AVENUE YOLO', ang: 24, len: 138, oneway: 'out' },
        { n: 28, s: 15839, side: -1, from: 'road', len: 45, oneway: 'in', lawnBefore: true },
        // sans nom, le long du Marché Yolo : part du petit boulevard (l'auteur : à la 7e Rue, côté résidentiel, seulement
        // deux entrées sur le boulevard, l'Avenue Yolo et la 2e entrée)
        { n: 29, s: 15895, side: -1, from: 'pb', len: 126 },
        { n: 30, s: 15929, side: 1, from: 'pb', name: '6e RUE', len: 80 },
        { n: 31, s: 15975, side: -1, from: 'pb', name: 'AVENUE GARDÉNIAS', len: 110 },
        { n: 32, s: 16118, side: 1, from: 'pb', name: '5e RUE', len: 80 },
        { n: 33, s: 16259, side: -1, from: 'pb', name: 'AV. HORTENSIAS', len: 52 },
        { n: 34, s: 16310, side: 1, from: 'pb', name: '4e RUE', len: 80 },
        { n: 35, s: 16330, side: -1, from: 'service', len: 24 },
        { n: 36, s: 16503, side: 1, from: 'pb', name: '3e RUE', len: 80 },
        { n: 37, s: 16532, s2: 16510, side: -1, from: 'road', name: 'AV. RÉVOLUTION', ang: -63, len: 277 },
        { n: 38, s: 16692, side: 1, from: 'pb', name: '2e RUE', len: 80 },
        { n: 39, s: 16752, side: -1, from: 'pb', name: 'AV. TROPIQUES', ang: -60, len: 100 },
        // « 1ère Rue » d'OSM : simple entrée, sans feux (pour l'auteur, la 1re Rue est la rue après HJ Hospitals)
        { n: 40, s: 16881, side: 1, from: 'road', len: 90 },
        // Après le pont sur la Yolo (16 974–17 003 m, voir rivers) : entrée de HJ Hospitals, 20 m après le pont, dans sa cour
        { n: 41, s: 17021, side: 1, from: 'road', len: 0, w: 7 },
        // 1re Rue (l'auteur ; « Avenue Saint Christophe » dans OSM) : côté industriel elle part tout droit puis s'incline
        // vers l'avant ; côté résidentiel, le petit boulevard rejoint le boulevard en biais (et continue vers Saint Raphaël)
        { n: 42, s: 17172, side: 1, from: 'road', name: '1re RUE', ang: 15, len: 90 },
        { n: 42, s: 17172, s2: 17154, side: -1, from: 'road', len: 0 },
      ],
      median: [14098, 15010, 15182, 15737, 16881],   // ouvertures du terre-plein (la 16e Rue est dans sideRoads)
      // Bande côté industriel (l'auteur, 31/10 ; vidéo « LIMETE 15ème rue ｜ Décoration de la nativité ») : décorations
      // lumineuses de l'entrée de la 16e Rue à la 15e Rue ; petit parc de jeux pour enfants de la 14e Rue jusqu'à 10 m de la
      // passerelle (before : m de jeu avant son axe, escaliers compris)
      stripParks: [{ kind: 'lights', side: 1, s0: 13435, s1: 13835 }, { kind: 'playground', side: 1, s0: 14098, s1: 14430, before: 13 }],
      // Carrefours à feux tricolores : la rue traverse tout le boulevard (plus de séparation), les voitures s'arrêtent au rouge
      // et d'autres sortent de la rue pendant son vert (demande de l'auteur) : 14e Rue, 10e Rue / Zinnias (en T : la 10e Rue
      // s'arrête au petit boulevard, les voitures des Zinnias tournent à gauche), 7e Rue / Avenue Yolo, 1re Rue.
      // Un nombre = position (m) ; [position, largeur du carrefour en m de jeu] pour une rue plus large.
      signals: [14098, [15182, 14], 15737, 17172],
      cuts: [15010, 15839],                  // séparation enlevée, sans feux (11e Rue, 2e entrée de la 7e Rue)
      zebras: [13450, 14706, 17173],                        // passages piétons au sol
      leftStops: [[13528, 'Motel Fikin'], [13801, '15e Rue'], [14819, '12e Rue'], [15612, '8e Rue'], [16016, '5e Rue'], [16734, '2e Rue'],
        [17305, '1ère Rue']],                // « Arrêt 1ère Rue » d'OSM, avant la passerelle
      // Croisement du boulevard Sendwe, au bout du trajet (l'auteur ; OSM) : le grand boulevard tourne à gauche (Sendwe),
      // le boulevard Lumumba continue un peu à droite ; la station Cohydro est dans la pointe entre les deux (pas dans OSM,
      // placée d'après l'auteur) et l'église Cité Béthel en face, côté industriel (siège « de la Funa », ACP)
      fork: {
        left: 'BD SENDWE', right: 'BD LUMUMBA',
        station: { name: 'COHYDRO', sub: 'Station-service' },
        church: { name: 'CITE BETHEL' },     // comme sur l'immeuble (photos de l'auteur)
      },
      places: [
        { kind: 'fuel', name: 'TOTAL', s: 13850, side: -1 },                                       // n° 4 : boucle 377–453 m
        // Côté résidentiel, juste après la 16e Rue (l'auteur, 30/10) : Kin Marché en face de l'entrée de la 16e Rue (OSM : 66 m
        // avant), puis une résidence privée (deux immeubles à étages, portail entre deux colonnes), puis le Motel Fikin derrière
        // sa clôture en treillis (on voit l'intérieur), puis la station Total (« station de la 14e Rue »)
        { kind: 'supermarket', name: 'KIN MARCHÉ', sub: 'Supermarché · Alimentation', s: 13435, side: -1, w: 16, depth: 16, floors: 2, color: '#c8102e' },
        { kind: 'residence', s: 13510, side: -1, w: 30 },
        { kind: 'hotel', name: 'MOTEL FIKIN', sub: 'Hôtel · Limete', s: 13593, side: -1, w: 12, floors: 3, set: 6, fence: 'lattice', plot: 26 },
        { kind: 'market', name: 'MARCHÉ YOLO', sub: 'Limete', s: 15935, side: -1 },
        // Croquis de l'auteur (7e Rue) : l'Hôtel Ixhoras avant l'Avenue Yolo, le marché d'objets traditionnels (statues,
        // masques, pagnes ; sans nom) entre les deux entrées, Rawbank après la 2e entrée. replaces : bâtiment OSM retiré
        // Ixoras : enseigne bordeaux sur bandeau gris foncé, boutiques de téléphones au rez-de-chaussée, à l'angle de l'Ixhoras
        // Avenue (vidéo « Limeté 7eme Rue, Place Commerciale », 4:16)
        { kind: 'hotel', name: 'IXORAS HOTEL', sub: '', s: 15736, side: -1, w: 7.5, depth: 8, floors: 3, color: '#2b3036', wall: 0x646a72,
          text: '#e2475c', shops: true, corner: true, replaces: 'Hotel Ixhoras' },
        { kind: 'crafts', s: 15798, side: -1, w: 22 },
        { kind: 'bank', name: 'RAWBANK', s: 15867, side: -1, w: 10, floors: 3, color: '#0b6e4f', replaces: 'Rawbank' },
        { kind: 'school', name: 'C.S. PETITE THÉRÈSE', sub: 'Complexe Scolaire · Limete', s: 16427, side: 1 },
        // HJ Hospitals (l'auteur, OSM) : très grand immeuble juste après la Yolo, jusqu'à la 1re Rue ; sa cour de
        // stationnement occupe la bande jusqu'au boulevard (boucle de service d'OSM), entrée 20 m après le pont
        { kind: 'hospital', name: 'HJ HOSPITALS', sub: 'Limete', s: 17080, side: 1, w: 52, depth: 24, floors: 6,
          court: [17008, 17158], replaces: 'HJ Hospitals Limete' },
        // Église Saint Raphaël (OSM), côté résidentiel derrière le petit boulevard, après la passerelle ; aspect d'après la
        // photo de l'auteur (murs jaunes, toits en gradins, croix sur le haut mur du fond)
        { kind: 'church', look: 'steps', name: 'ÉGLISE SAINT RAPHAËL', sub: 'Paroisse catholique · Limete', s: 17465, side: -1, w: 28,
          replaces: 'Saint Raphaël' },
      ],
    },
    // Prolongement après la fourche Sendwe (l'auteur, 31/10) : boulevard Sendwe, boulevard Triomphal, avenue de la Libération
    // (ex-24 Novembre) jusqu'au boulevard du 30 Juin. OSM (dossier TPF) : 6,69 km. s : mètres réels depuis la fourche.
    // Aspect d'après les vidéos du dossier Route24 (repères seulement) et la vidéo du Centre culturel.
    ext: {
      from: 17545,
      h0: -28,                    // cap réel du boulevard Lumumba en arrivant à la fourche (OSM)
      // virages : s (centre), cap réel après le virage (degrés, 0 = nord), rayon de jeu (m) ; puis la petite courbe de la Libération
      corners: [{ s: 100, to: -67.5, r: 100 }, { s: 1465, to: -106.4, r: 70 }, { s: 3545, to: 9.3, r: 36 }],
      keys: [[3650, 9.3], [3850, 5.8], [4100, 2.2], [4250, -2], [4450, -6], [4600, -6.5], [4700, -9.7], [4800, -12.2],
        [4950, -13.9], [5100, -16.7], [5250, -21], [5450, -23.5], [5600, -26], [5750, -30.4], [5900, -31.7], [6000, -32.3], [6560, -33],
        ],
      b: 1450,                    // carrefour Kasa-Vubu : fin du boulevard Sendwe, début du boulevard Triomphal
      kvCross: { s: 1450, k: -0.452, hw: 9 },   // (l'avenue Kasa-Vubu y passe en biais : z = z0 + k·x ; ni trottoir ni façade sur son passage)
      c: 3545,                    // virage à droite sur l'avenue de la Libération (bretelle)
      d: 1e6,                     // (plus de virage à Mandela : le 24 Novembre entre dans le vrai Boulevard du 30 Juin, voir `attach`)
      // Cours d'eau latéraux (Google Maps dossier sendwe + OSM) : ruisseau Est du Stade, ruisseau longeant le Triomphal de
      // Kinshasa Arena jusqu'aux Huileries (avec dalot sous l'Av. des Huileries), ruisseau du Parc de l'INA, canal Permanence
      streams: [
        { s0: 765, s1: 980, side: -1, x: 24, w: 4.5, alongRoad: 800 },                // Rivière Funa longeant le Bd Permanence
        { s0: 1540, s1: 1790, side: 1, x: 34, w: 4.0 },                               // Ruisseau Est du Stade des Martyrs
        { s0: 1920, s1: 2520, side: 1, x: 28, w: 4.5, bridgeAt: 2400 },               // Ruisseau Arena → Av. des Huileries → Polyclinique Action
        { s0: 2480, s1: 2860, side: -1, x: 38, w: 4.0 },                              // Ruisseau du Parc de l'INA / Centre Culturel
      ],
      // Avenues et entrées de rues (Google Maps dossier sendwe + OSM) : côté 1 = droite, -1 = gauche dans le sens de la marche
      streets: [
        // 1. Boulevard Sendwe (0 → 1 450 m)
        { s: 60, side: -1, name: "AV. DE L'UNIVERSITÉ", sub: 'Le Chalet de Kinshasa · Limete', ang: -12, w: 8, len: 42 },
        { s: 155, side: -1, name: 'RUE FINANT', sub: 'Kulumba · Vumbi · Ruindi', w: 6.5, len: 48 },
        { s: 220, side: -1, name: 'AVENUE BUSINGA', sub: 'Hôtel Sainte-Marthe · Mabenga', w: 7.5 },
        { s: 705, side: 1, name: 'AV. DU PEUPLE · LUAMBO', sub: 'Kasa-Vubu · Kabasele Joseph', w: 9 },
        { s: 800, side: -1, name: 'BD DE LA PERMANENCE', sub: 'Kalamu · Stade Tata Raphaël', w: 8.5 },
        { s: 875, side: -1, name: 'RUE MPOZO', sub: 'Rue de Vista · Kalamu', w: 6.5 },
        { s: 890, side: 1, name: 'RUE DE MOANDA', sub: 'Wakanda · Siliki Village', ang: -35, w: 7 },
        { s: 1130, side: -1, name: 'RUE DE LA MATEBA', sub: 'Rue de Vista · Kalamu', w: 7 },
        { s: 1130, side: 1, name: 'ENTRÉE HÔTEL SENDWE', sub: 'Siliki Village · Kasa-Vubu', w: 6.5 },
        { s: 1305, side: -1, name: 'RUE DE GOMBARI', sub: 'Mosquée Alfalah · Kalamu', w: 7 },
        { s: 1305, side: 1, name: 'RUE DE GOMBARI', sub: 'Rue de Moanda · Pont Ngabi', w: 7 },
        // 2. Boulevard Triomphal (1 450 → 3 545 m)
        { s: 1665, side: 1, name: 'ENTRÉE STADE (EST)', sub: 'Stade des Martyrs', w: 7, len: 34 },
        { s: 1835, side: 1, name: 'ENTRÉE STADE DES MARTYRS', sub: 'Complexe Omnisports', w: 9, len: 34 },
        { s: 2135, side: -1, name: "AV. DE L'ENSEIGNEMENT", sub: 'Lycée Mme de Sévigné · Kasa-Vubu', w: 7.5 },
        { s: 2400, side: 1, name: 'AVENUE DES HUILERIES', sub: 'Lingwala · Gombe ↑', w: 11 },
        { s: 2400, side: -1, name: 'AV. ASSOSSA · HUILERIES', sub: 'Kasa-Vubu ↓', w: 11 },
        { s: 3060, side: 1, name: 'ACCÈS PALAIS DU PEUPLE', sub: 'HET Triomphal · Tembe na Tembe', w: 8, len: 42 },
        { s: 3060, side: -1, name: 'AV. SAIO · AV. DE LA VICTOIRE', sub: 'IFAD · Rue de Kimwenza', w: 10 },
        { s: 3185, side: 1, name: 'ACCÈS MUSÉE NATIONAL', sub: 'Institut des Musées Nationaux', w: 7.5, len: 34 },
        { s: 3290, side: -1, name: 'ENTRÉE E.N.M · TRIOMPHAL PARK', sub: 'Inpess · IFAD', w: 7.5, len: 38 },
        { s: 3355, side: 1, name: 'ENTRÉE SALLE PANACÉE', sub: 'Salle de fête Panacée · Stradeg Studio', w: 7, len: 38 },
        { s: 3435, side: -1, name: 'RUE ÉVANGILE DU SALUT', sub: 'PNMLS · G-tinte Academy', w: 7, len: 36 },
        // 3. Avenue de la Libération / ex-24 Novembre (3 545 → 6 693 m)
        { s: 3745, side: 1, name: 'ENTRÉE CENTENAIRE · UPC', sub: "Rawbank (UPC) · Yummy's", w: 7, len: 38 },
        { s: 4205, side: -1, name: 'RUE DU CAMP KOKOLO', sub: 'Camp Lt Kokolo · Kintambo', w: 7.5 },
        { s: 4205, side: 1, name: 'AV. CENTRE SPORTIF DE JUDO', sub: 'Cité de la Voix du Peuple · RTNC', w: 8.5 },
        { s: 4617, side: 1, name: 'AV. DE KABINDA · BUKAMA', sub: 'Centre Hospitalier Kabinda · Lingwala', ang: -20, w: 8 },
        { s: 4676, side: -1, name: 'AV. SERGENT MOKE', sub: 'Salle Cristal de Lonie · Kintambo · Asanef', w: 9 },
        { s: 4677, side: 1, name: 'AV. NYANGWE', sub: 'Lingwala · Arrêt Asanef', w: 9 },
        { s: 4777, side: 1, name: 'RUE DE KALEMBELEMBE', sub: 'Lingwala', w: 6.5 },
        { s: 4940, side: 1, name: "RUE D'AKETI · RUE DE BUTA", sub: 'Lingwala', w: 6.5 },
        { s: 5015, side: 1, name: 'RUE DE LIBENGE', sub: 'Lingwala', w: 6.5 },
        { s: 5075, side: 1, name: 'RUE DE ISANGI', sub: 'Lingwala', w: 6.5 },
        { s: 5140, side: 1, name: 'RUE DE BOENDE', sub: 'Lingwala', w: 6.5 },
        { s: 5205, side: 1, name: 'RUE DE BUSANKUSU · LIMAYA', sub: 'Lingwala', w: 6.5 },
        { s: 5255, side: -1, name: 'AVENUE DE LA SCIENCE', sub: 'Institut Paul VI · Gombe', w: 8 },
        { s: 5290, side: 1, name: 'RUE DE NGELE', sub: 'Lingwala', w: 6.5 },
        { s: 5355, side: 1, name: 'RUE DE KASONGO LUNDA', sub: 'Lingwala', w: 6.5 },
        { s: 5420, side: 1, name: 'RUE DE MWEKA', sub: 'Lingwala', w: 6.5 },
        { s: 5480, side: 1, name: 'RUE DE LUISA', sub: 'Lingwala', w: 6.5 },
        { s: 5535, side: -1, name: 'ENTRÉE BEAUX-ARTS', sub: 'Académie des Beaux-Arts · Eyano', w: 7, len: 34 },
        { s: 5545, side: 1, name: 'AV. PANYA MUTOMBO · BOMU', sub: 'Lingwala', w: 6.5 },
        { s: 5640, side: -1, name: 'AVENUE MBOMBU', sub: 'ISAU · Architecture & Urbanisme', w: 7 },
        { s: 5661, side: 1, name: 'RUE ITAGA', sub: 'Rue du Lac Moero · Lingwala', w: 7.5 },
        { s: 5735, side: 1, name: 'RUE DE LUVUA', sub: 'Lingwala', w: 6.5 },
        { s: 5840, side: 1, name: 'AVENUE DE KATO', sub: 'Lycée Prince de Liège · Lingwala', w: 7 },
        { s: 5948, side: 1, name: 'AV. DU MONT DES ARTS · CERCLE', sub: 'Golf · Clinique · Gombe', w: 9 },
        { s: 5950, side: -1, name: 'AVENUE DE LA GOMBE', sub: 'Gombe', w: 9 },
        { s: 6265, side: 1, name: 'AV. DES CITRONNIERS', sub: 'Hôtel Golf Coast by Ixoras · Gombe', w: 7.5 },
        { s: 6345, side: -1, name: 'AVENUE DRACENA', sub: 'Institut Aurora · Gombe', w: 7.5 },
        { s: 6435, side: -1, name: 'PLACE DES SAFOUTIERS', sub: 'Avenue des Safoutiers · Gombe', w: 7 },
        { s: 6455, side: 1, name: 'AVENUE DES ORANGERS', sub: 'Gombe', w: 7 },
        { s: 6540, side: 1, name: 'AV. DES FLAMBOYANTS', sub: 'Av. des Jacarandas · Gombe', w: 7.5 },
      ],
      // Lieux nommés (Google Maps dossier sendwe + OSM + vidéos Route24).
      // s : m réels après la fourche ; w : longueur le long du boulevard (m de jeu) ; s0/s1 : murs et palissades
      places: [
        // 1. Boulevard Sendwe (Zoka Deluxe 2 vient avant le boulevard Kasa-Vubu, demande de l'auteur)
        { kind: 'fuel', name: 'ENGEN', s: 268, side: -1 },
        { kind: 'radio', name: 'RADIO MARIA RDC', sub: 'Kinshasa · Sendwe', s: 296, side: 1 },
        { kind: 'block', name: 'PIZZA INN', sub: 'Restaurant · Sendwe', s: 315, side: -1, w: 10, floors: 2, color: '#d62828', wall: 0xf4efe6 },
        { kind: 'block', name: 'KIN MARCHÉ', sub: 'Supermarché · Sendwe', s: 350, side: -1, w: 16, floors: 2, color: '#c8102e', wall: 0xf2f2ee },
        { kind: 'school', name: 'ISS KIN', sub: 'Institut Supérieur de Statistique', s: 400, side: -1 },
        { kind: 'stadium_far', name: 'STADE TATA RAPHAËL', s: 430, side: -1 },
        { kind: 'block', name: 'CHINA CITY INVESTMENT', sub: 'Complexe · Sendwe', s: 495, side: 1, w: 20, floors: 3, color: '#1d6b3a', wall: 0xe8ecf0 },
        { kind: 'fuel', name: 'TOTAL', s: 565, side: -1 },                   // « Total Stade »
        { kind: 'church', name: 'ÉGLISE SONI KAFUTA', sub: 'Église Cité Salem · Kasa-Vubu', s: 815, side: 1 },
        { kind: 'block', name: 'LUZ PAINT', sub: 'Peintures · Kalamu', s: 838, side: -1, w: 11, floors: 2, color: '#0b5d8f', wall: 0xf2f2ee },
        { kind: 'block', name: 'HÔTEL SENDWE · WAKANDA', sub: 'Siliki Village · Kasa-Vubu', s: 1045, side: 1, w: 16, floors: 3, color: '#8e2b2b', wall: 0xf5efe2 },
        { kind: 'block', name: 'HÔTEL AMANI INN', sub: 'Église du Sang Précieux', s: 1245, side: -1, w: 15, floors: 3, color: '#b8336a', wall: 0xf4f0ea },
        { kind: 'block', name: 'ADK SEMENCES · 5ASEC', sub: 'Pont Ngabi · Kasa-Vubu', s: 1378, side: 1, w: 12, floors: 2, color: '#1d6b3a', wall: 0xeeeeea },
        { kind: 'fuel', name: 'KM OIL', s: 1305, side: -1 },   // (l'auteur, 08/11 : à 1 405 m, elle débordait sur l'avenue Kasa-Vubu et le virage ; juste avant le pont Cabu)
        { kind: 'block', name: 'ZOKA DELUXE 2', sub: 'Hôtel · Avant Bd Kasa-Vubu', s: 1418, side: 1, w: 14, floors: 3, color: '#b8336a', wall: 0xf4f0ea },
        // 2. Boulevard Triomphal (corrections de l'auteur : terrain vide en face du Stade, Sévigné en diagonale,
        // Kinshasa Arena suivi d'un espace vide avant les Huileries, puis directement Palais du Peuple en face du
        // Musée International / Centre Culturel dès la sortie des Huileries, et PNMLS en face de l'entrée Panacée)
        { kind: 'empty_lot', s0: 1535, s1: 2115, side: -1 },                  // Grand terrain vide en face du Stade des Martyrs
        { kind: 'stadium', name: 'STADE DES MARTYRS', s: 1765, side: 1 },
        { kind: 'arena', name: 'KINSHASA ARENA', sub: 'Complexe Omnisports · Stade des Martyrs', s: 2010, side: 1 },
        { kind: 'empty_lot', s0: 2090, s1: 2385, side: 1 },                   // Espace vide entre Kinshasa Arena et la route des Huileries
        { kind: 'school', name: 'LYCÉE MADAME DE SÉVIGNÉ', sub: 'En diagonale du Stade · Kinshasa', s: 2180, side: -1 },
        { kind: 'block', name: 'SNEL', sub: "Société nationale d'électricité", s: 2295, side: -1, w: 24, floors: 4, color: '#0b4f9c', wall: 0xe9edf2, set: 8 },
        { kind: 'culture', name: 'MUSÉE INTERNATIONAL · CENTRE CULTUREL', s: 2720, side: -1 },   // commence directement après les Huileries (2420 → 3020)
        { kind: 'palais', name: 'PALAIS DU PEUPLE', s: 2720, side: 1 },       // commence directement après les Huileries (2420 → 3020), en face du Musée International
        { kind: 'tembe', name: "IMMEUBLE TEMBE N'A TEMBE", sub: 'HET Triomphal', s: 3120, side: 1 },
        { kind: 'block', name: 'TRIOMPHAL PARK · IFAD', sub: 'Institut Facultaire de Développement · E.N.M', s: 3210, side: -1, w: 24, floors: 3, color: '#1d6b3a', wall: 0xf2f2ee, set: 8 },
        { kind: 'museum', name: 'MUSÉE NATIONAL (MNRDC)', sub: 'de la République démocratique du Congo · IMNC', s: 3255, side: 1 },
        { kind: 'pnmls', name: 'PNMLS', sub: 'Programme national multisectoriel de lutte contre le sida', s: 3360, side: -1 },   // en face de l'entrée de la Salle Panacée
        { kind: 'block', name: 'SALLE DE FÊTE PANACÉE', sub: 'Stradeg Studio · Triomphal', s: 3380, side: 1, w: 16, floors: 2, color: '#8e44ad', wall: 0xf4f0ea, set: 6 },
        // 3. Avenue de la Libération (ex-24 Novembre)
        { kind: 'wall', name: 'CAMP LT KOKOLO', sub: 'FARDC', s0: 3660, s1: 4540, side: -1, gate: 4000, color: 0xeeeeea, sign: '#2f5d2f', trees: true },
        { kind: 'block', name: "RAWBANK (UPC) · YUMMY'S", sub: 'Banque & Restaurant · 24 Novembre', s: 3695, side: 1, w: 14, floors: 3, color: '#1a1a1a', text: '#f5c400' },
        { kind: 'church_big', name: 'CATHÉDRALE DU CENTENAIRE', sub: 'Église du Christ au Congo', s: 3825, side: 1 },
        { kind: 'campus', name: 'UNIVERSITÉ PROTESTANTE AU CONGO', sub: 'UPC · Lingwala', s: 4070, side: 1 },
        { kind: 'hoarding', s0: 4145, s1: 4185, side: 1, color: 0x1d5fbf, css: '#1d5fbf' },
        { kind: 'block', name: 'CENTRE SPORTIF DE JUDO', sub: 'Cité de la Voix du Peuple · RTNC', s: 4250, side: 1, w: 16, floors: 2, color: '#1d6b3a', wall: 0xf2f2ee },
        { kind: 'rtnc_pond', s: 4350, side: 1 },                              // Bassin / étang en croissant devant la RTNC (Google Maps)
        { kind: 'tower', s: 4440, side: 1 },                                  // RTNC, Cité de la Voix du Peuple
        { kind: 'block', name: 'SALLE CRISTAL DE LONIE', sub: 'Mwamba Nathan · 24 Novembre', s: 4610, side: -1, w: 14, floors: 2, color: '#8e44ad', wall: 0xf4f0ea },
        { kind: 'asanef', s: 4677 },                                          // sous le saut-de-mouton (voir flyovers)
        { kind: 'urk', name: 'UNIVERSITÉ RÉV. KIM', sub: 'Campus de la Gombe', s: 4860, side: 1 },
        { kind: 'billboard', text: 'SAMSUNG', sub: 'Galaxy', bg: '#1428a0', s: 4888, side: 1, tall: true },
        { kind: 'block', name: 'CENCO', sub: 'Conférence épiscopale nationale du Congo', s: 4908, side: 1, w: 14, floors: 3, color: '#1d4fa0', wall: 0xf4f4f2 },
        { kind: 'block', name: 'COME COM', sub: 'Avenue du 24 Novembre · Lingwala', s: 5045, side: 1, w: 15, floors: 3, color: '#0077cc', wall: 0xf6f6f4 },
        { kind: 'cathedral', name: 'CATHÉDRALE NOTRE-DAME DU CONGO', sub: 'Maison des Frères · Institut Paul VI', s: 5090, side: -1, set: 26 },
        { kind: 'glass', s: 5172, side: 1, w: 14, floors: 6, round: true, band: 0xd81b60, glass: 0xa8c4d8 },   // immeuble rose au coin arrondi
        { kind: 'netted', s: 5248, side: 1, w: 14, floors: 7 },               // chantier sous filet vert
        { kind: 'wall', s0: 5285, s1: 5510, side: -1, color: 0x3fb3a8, top: 0x2f8f86, h: 2.4, trees: true, palms: true },   // mur turquoise
        { kind: 'beaux_arts', name: 'ACADÉMIE DES BEAUX-ARTS', sub: 'Eyano · Kinshasa · Gombe', s: 5589, side: -1 },
        { kind: 'fuel', name: 'ENGEN', s: 5698, side: -1 },
        { kind: 'block', name: 'ISAU · CEV', sub: "Institut Supérieur d'Architecture et d'Urbanisme", s: 5760, side: -1, w: 16, floors: 3, color: '#3d4b5c', wall: 0x8f969e },
        { kind: 'billboard', text: 'PRIMUS', sub: 'La bière du Congo', bg: '#1d3f9a', fg: '#f5c400', s: 5762, side: 1, bw: 10, bh: 3.4 },
        { kind: 'school', name: 'LYCÉE PRINCE DE LIÈGE', sub: 'École belge · Avant Av. de Kato', s: 5798, side: 1 },   // à droite avant la route Kato (l'auteur)
        { kind: 'block', name: 'GALAXY · ÉCOLE RÉV. KIM', sub: 'Supermarché · Complexe scolaire', s: 5885, side: 1, w: 16, floors: 5, color: '#3a4652', wall: 0xa3a9ae, shops: true },
        { kind: 'rotunda', name: 'Haier', s: 5995, side: 1 },                // au coin de l'avenue du Mont des Arts (« Empire »)
        { kind: 'mall', s: 6085, side: 1 },
        { kind: 'glass', name: 'INFINITY · NICE CREAM', sub: 'Center · Restaurant', s: 6165, side: 1, w: 20, floors: 9, band: 0x7a3b2e, glass: 0x3a6ea5 },
        { kind: 'block', name: 'TECNO', sub: 'Smartphones', s: 6200, side: -1, w: 10, floors: 2, color: '#1d6fd1' },
        { kind: 'glass', s: 6230, side: 1, w: 14, floors: 8, build: true, glass: 0x3a6ea5 },   // tour vitrée en chantier, grue
        { kind: 'block', name: 'INSTITUT SUPÉRIEUR DE COMMERCE', sub: 'ISC Kinshasa', s: 6285, side: -1, w: 24, floors: 3, color: '#0b5d3b', wall: 0xf0d36b },
        { kind: 'school', name: 'INSTITUT AURORA', sub: 'Av. Dracena · Gombe', s: 6385, side: -1 },
        { kind: 'block', name: 'UBA', sub: 'United Bank for Africa', s: 6475, side: -1, w: 14, floors: 3, color: '#d71920' },
        { kind: 'block', name: 'AMBASSADE DU GHANA', sub: 'Gombe', s: 6515, side: -1, w: 16, floors: 2, color: '#006b3f', wall: 0xf2efe6 },
        { kind: 'fuel', name: 'TOTALENERGIES', s: 6592, side: -1 },
        { kind: 'wall', name: 'AMBASSADE DE BELGIQUE', sub: 'Gombe', s0: 6565, s1: 6640, side: 1, color: 0xb9bcbf, top: 0x9ea2a6, h: 4.2, wire: true, sign: '#3a4652' },
      ],
    },
    // Façades photographiques (data/tex/strips, tirées des vidéos avec l'accord des auteurs)
    backdrops: {
      right: ['lum_1', 'lum_3', 'lum_5', 'lum_2', 'lum_4'],
      left: ['lum_4', 'lum_2', 'lum_5', 'lum_3', 'lum_1'],
      highwayRight: [],
      highwayLeft: [],
    },
  },

  triomphal: {
    id: 'triomphal',
    title: 'Boulevard Triomphal',
    subtitle: 'Avenue de la Libération → Avenue Kasa-Vubu',
    realKm: 2.05,
    data: 'data/triomphal.json',
    scale: 1,                     // trajet court : distances réelles
    lanes: 3,
    shiftSeconds: 240,            // une matinée
    versement: 10000,
    fuelStart: 70,
    style: 'monumental',
    intro: "Boulevard Triomphal, carrefour de l'avenue de la Libération (ex-24 Novembre). Les clients attendent au bord du trottoir.",
    start: 'junction',
    startSign: ['BOULEVARD TRIOMPHAL', 'Palais du Peuple · Stade des Martyrs · Kasa-Vubu ↑'],
    end: { kind: 'junction', name: 'Avenue Kasa-Vubu', short: 'Kasa-Vubu', trim: 40 },
    landmarks: [
      ['Avenue de la Libération (24 Nov.)', 'Libération', 0],
      ['Avenue de la Victoire', 'Victoire', 551],
      ['Centre Culturel Afrique Centrale', 'Centre Culturel', 759, true],
      ['Palais du Peuple', 'Palais', 826],
      ['Rue Kanda-Kanda', 'Kanda-Kanda', 1050, true],
      ['Lycée Madame de Sévigné', 'Sévigné', 1337, true],
      ['Stade des Martyrs', 'Stade', 1666],
    ],
    rivers: [],
    flyovers: [],
    footbridges: [],
    busStops: [240, 680, 1280, 1780],
    stations: [['Station Palais du Peuple', 1160]],
    crossings: [[551, 'Av. de la Victoire'], [1097, 'Rue Kanda-Kanda'], [1420, 'Av. de l\'Enseignement']],
    greenMedianUntil: 'END',
    separator: false,             // terre-plein paysager avec palmiers en bacs blancs, lampadaires doubles et bordures rouge/blanc
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [
      { kind: 'culture', s: 759, side: 1, name: "CENTRE CULTUREL ET ARTISTIQUE D'AFRIQUE CENTRALE" },
      { kind: 'palais', s: 826, side: -1, name: 'PALAIS DU PEUPLE' },
      { kind: 'stadium', s: 1666, side: -1, name: 'STADE DES MARTYRS' },
    ],
    workers: [300, 980, 1500],    // équipes du Service national au travail
    sideRoads: [
      { s: 225, side: -1, name: 'AV. DU LIVRE', sub: 'Musée National · Lingwala' },
      { s: 320, side: 1, name: 'AV. ASSOSSA', sub: 'IFAD · Kasa-Vubu' },
      { s: 470, side: 1, name: 'AV. SHABA', sub: 'Kasa-Vubu', ang: 20 },
      { s: 1120, side: 1, name: 'AV. DES HUILERIES', sub: 'INA · Lingwala → Gombe', ang: 24 },
      { s: 1150, side: -1, name: 'AV. DE LA DÉMOCRATIE', sub: 'Station Palais du Peuple', ang: -20 },
      { s: 1290, side: 1, name: 'ENTRÉE SNEL', sub: 'Sous-station · Gombe' },
      { s: 1580, side: -1, name: 'AV. MUSHIE', sub: 'Kinshasa Arena · Lingwala', ang: -18 },
      { s: 1680, side: 1, name: 'ENTRÉE STADE EST', sub: 'Complexe Omnisports' },
      { s: 1850, side: -1, name: 'ENTRÉE STADE', sub: 'Stade des Martyrs · Lingwala' },
    ],
  },

  // Route Poids Lourds (tools/poids_lourds.py, OSM ; vidéos du dossier « Routes poids lourds », regardées seulement comme modèle) :
  // elle prolonge la route des rails du Pont Matete (world.js MAT_PL) jusqu'à la Place de la Gare. Construite dans la même scène
  // que le trajet principal, comme le Boulevard du 30 Juin (voir `attachPL`). s = m réels depuis le début de data/poidslourds.json,
  // soit plKm(m réels depuis le boulevard Lumumba, comme sur le « plan Route Poids Lourds (OSM) »).
  poidslourds: {
    id: 'poidslourds',
    title: 'Route Poids Lourds',
    subtitle: 'Pont Matete → Limete Industriel → Kingabwa → Place de la Gare',
    realKm: 9.94,
    data: 'data/poidslourds.json',
    scale: 0.40987,               // (calculée par tools/poids_lourds.py pour que le bout tombe sur la Place de la Gare)
    lanes: 2,                     // une seule chaussée à 2 × 2 voies, sans terre-plein
    shiftSeconds: 300,
    versement: 10000,
    fuelStart: 70,
    style: 'popular',
    industrial: true,             // caniveaux à blocs, chemin de fer à gauche, murs d'usine et hangars : addPoidsLourds
    separator: false,
    highwayUntil: 'Place de la Gare',   // (terre-plein simplement peint : on traverse partout)
    intro: 'Route Poids Lourds : Limete Industriel, Kingabwa, puis la Place de la Gare.',
    start: 'attached',
    startSign: ['ROUTE POIDS LOURDS', 'Kingabwa · Ndolo · Place de la Gare ↑'],
    end: { kind: 'open', name: 'Place de la Gare', short: 'Place de la Gare', trim: 14 },
    landmarks: [
      ['Limete Industriel', 'Limete Ind.', plKm(1200)],   // (après l'évasement du début : les clients y descendent)
      ['17e Rue', '17e Rue', plKm(1398), true],
      ['16e Rue', '16e Rue', plKm(1844), true],
      ['15e Rue', '15e Rue', plKm(2217), true],
      ['14e Rue Limete Industriel', '14e Rue', plKm(2723)],
      ['Kulumba', 'Kulumba', plKm(3501), true],
      ['Station Total', 'Total', plKm(4100), true],
      ['Avenue Iveco', 'Iveco', plKm(4363), true],
      ['Kingabwa', 'Kingabwa', plKm(6112)],
      ['Halte Limete Amicongo', 'Amicongo', plKm(6342), true],
      ["Avenue de l'Aérodrome", 'Aérodrome', plKm(7063)],
      ['Gare de Ndolo · Prison militaire', 'Ndolo', plKm(8560)],
      ['Bralima', 'Bralima', plKm(9169), true],
      ["Gare de l'Est", "Gare de l'Est", plKm(10676), true],
    ],
    rivers: [
      ['Rivière Funa', plKm(6972), 12, 'Pont Funa'],
      ['Canal', plKm(9529), 8, 'Pont du Canal'],
    ],
    flyovers: [],
    footbridges: [],
    busStops: [1750, 2300, 2900, 3700, 4700, 5300, 6050, 6700, 7500, 8200, 9100].map(km => plKm(km)),
    stations: [['Station Total', plKm(4100)]],
    crossings: [],
    greenMedianUntil: null,
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [],
    workers: [],
    // Rues d'après OSM : côté gauche, seules les 14e à 17e Rues et l'Av. de l'Aérodrome traversent les rails vers Limete
    // (l'auteur, 06/11 : les 12e et 13e Rues ne traversent pas)
    sideRoads: [
      { s: plKm(1398), side: -1, name: '17E RUE', sub: 'Limete Industriel · Bd Lumumba' },
      { s: plKm(1497), side: 1, name: 'AVENUE GOODYEAR', sub: 'Limete Industriel' },
      { s: plKm(1844), side: -1, name: '16E RUE', sub: 'Limete Industriel · Bd Lumumba' },
      { s: plKm(2217), side: -1, name: '15E RUE', sub: 'Limete Industriel · Bd Lumumba' },
      { s: plKm(2723), side: -1, name: '14E RUE', sub: 'Limete Industriel · Bd Lumumba' },
      { s: plKm(3501), side: 1, name: 'AVENUE KULUMBA', sub: 'Kingabwa' },
      { s: plKm(4363), side: 1, name: 'AVENUE IVECO', sub: 'Kingabwa' },
      { s: plKm(5760), side: 1, name: 'AVENUE DE LA PLAINE', sub: 'Kingabwa' },
      { s: plKm(6112), side: 1, name: 'AVENUE KINGABWA', sub: 'Quartier de Kingabwa' },
      { s: plKm(6254), side: 1, name: 'AVENUE DES ENTREPÔTS', sub: 'Kingabwa' },
      { s: plKm(6527), side: 1, name: 'AVENUE MÉTALLURGIE', sub: 'Kingabwa' },
      { s: plKm(6800), side: 1, name: 'AVENUE BRASSERIE', sub: 'Kingabwa' },
      { s: plKm(7063), side: -1, name: "AVENUE DE L'AÉRODROME", sub: 'Ndolo · Boulevard Sendwe', w: 11 },
      { s: plKm(9517), side: 1, name: 'AVENUE DU CANAL', sub: 'Gombe' },
      { s: plKm(10580), side: 1, name: 'AVENUE WAGENIA', sub: 'Gombe · Place de la Gare' },
    ],
    // Décor (world.js addPoidsLourds), relevé sur les vidéos du dossier « Routes poids lourds » et sur OSM, en m réels depuis le
    // boulevard Lumumba. La vidéo « de A à Z » va de la Gare vers Matete : sa droite est notre gauche (côté rails).
    pl: {
      railFrom: 1057, railTo: 10640,
      // Circulation (vidéos) : surtout des camions et des tuk-tuks ; moitié moins de véhicules que sur 2 × 4 voies
      traffic: {
        our: ['truck', 'truck', 'truck', 'truck', 'keke', 'keke', 'keke', 'keke', 'moto', 'moto', 'moto', 'bus', 'bus', 'amb', 'taxi', 'car', 'police'],
        onc: ['truck', 'truck', 'truck', 'keke', 'keke', 'keke', 'moto', 'moto', 'bus', 'taxi', 'car'],
      },
      crossings: [[3189, 34, 'Passage à niveau'], [10201, -28, 'Passage à niveau']],   // (km, biais en degrés) : voie vers la droite
      // [début, fin, genre] : la suite des façades de chaque côté
      left: [
        [1057, 1500, 'trees'], [1500, 1760, 'houses'], [1760, 2700, 'lot'], [2700, 3200, 'shops'], [3200, 4400, 'wall'],
        [4400, 5700, 'wallAds'], [5700, 6300, 'wall'], [6300, 6930, 'trees'], [6930, 7400, 'shops'], [7400, 8330, 'wall'],
        [8330, 8730, 'prison'], [8730, 9090, 'trees'], [9090, 9450, 'brewery'], [9450, 9800, 'trees'], [9800, 10200, 'wallAds'],
        [10200, 10640, 'lot'],
      ],
      right: [
        [1057, 1380, 'shops'], [1380, 1500, 'redfence'], [1500, 1620, 'wall'], [1620, 1850, 'shed'], [1850, 2050, 'market'],
        [2050, 2250, 'tall'], [2250, 2600, 'longRed'], [2600, 3000, 'market'], [3000, 3450, 'shops2'], [3450, 3750, 'blueShack'],
        [3750, 4040, 'lot'], [4040, 4190, 'none'], [4190, 4600, 'trees'], [4600, 4900, 'longStore'], [4900, 5250, 'shed'],
        [5250, 5600, 'houses'], [5600, 5850, 'shops2'], [5850, 6000, 'tall'], [6000, 6250, 'market'], [6250, 6700, 'longBlue'],
        [6700, 6960, 'market'], [6960, 7250, 'shops'], [7250, 7600, 'lot'], [7600, 8100, 'shops'], [8100, 8600, 'houses'],
        [8600, 9200, 'market'], [9200, 9500, 'shops'], [9500, 9900, 'shed'], [9900, 10300, 'factory'], [10300, 10500, 'lawn'],
        [10500, 10720, 'tall'],
      ],
      // Lieux nommés d'OSM (côté gauche : derrière les rails)
      places: [
        { kind: 'commercial', km: 1318, side: -1, name: 'FRAMECO', sub: 'Limete Industriel', color: 0xe6e2d6, accent: 0x1d4fa0, h: 7.4 },
        { kind: 'bethesda', km: 1584, side: -1, name: 'MISSION MONDIALE BETHESDA', sub: 'Limete Industriel' },
        { kind: 'commercial', km: 1619, side: 1, name: 'SAFRICAS', sub: 'Limete Industriel', color: 0xdfe3e6, accent: 0x1d4fa0, h: 7.4 },
        { kind: 'commercial', km: 2244, side: 1, name: 'CENTRE DE SANTÉ BOLINGO', sub: '15e Rue', color: 0xf2efe8, accent: 0x0b7285, h: 7.4 },
        { kind: 'church', km: 2563, side: 1, name: 'COMMUNAUTÉ BAPTISTE DU CONGO', sub: 'Kingabwa' },
        { kind: 'church', km: 3135, side: 1, name: 'ÉGLISE JÉSUS REVIENT', sub: 'REMIDEL · Kingabwa' },
        { kind: 'halte', km: 6342, side: -1, name: 'HALTE LIMETE AMICONGO', sub: 'Chemin de fer' },
        { kind: 'commercial', km: 5621, side: 1, name: 'PETIT MARCHÉ DE BOIS', sub: 'Kingabwa', color: 0xc9a06a, accent: 0x7a4b2a, h: 4.6 },
        { kind: 'school', km: 5868, side: -1, name: 'COMPLEXE SCOLAIRE SERENA', sub: 'Kingabwa' },
        { kind: 'commercial', km: 6135, side: 1, name: 'SOUS-CIAT BAT', sub: 'Police · Kingabwa', color: 0xe6e6e0, accent: 0x1d4fa0, h: 4.6 },
        { kind: 'commercial', km: 6620, side: 1, name: 'JEHOVA PHARMA', sub: 'Pharmacie · Kingabwa', color: 0xf2efe8, accent: 0x1b8a3a, h: 4.6 },
        { kind: 'commercial', km: 6836, side: 1, name: 'BRIBANO MEDICAL', sub: 'Kingabwa', color: 0xf2efe8, accent: 0x0b7285, h: 7.4 },
        { kind: 'commercial', km: 7117, side: 1, name: 'HÔPITAL CMOA FORCE NAVALE', sub: 'Kingabwa', color: 0xf2f2ee, accent: 0x0b4f9c },
        { kind: 'halte', km: 8579, side: -1, name: 'GARE DE NDOLO', sub: 'Chemin de fer · Ndolo' },
        { kind: 'halte', km: 10676, side: -1, name: "GARE DE L'EST", sub: 'Kinshasa Est', big: true },
        { kind: 'commercial', km: 10580, side: 1, name: 'IMMEUBLE KILOU', sub: 'Place de la Gare', color: 0xf2f2ee, accent: 0x4a5a6a, h: 16 },
      ],
      billboards: [[1220, 1], [1750, -1], [2080, 1], [2650, 1], [3090, -1], [3700, 1], [3920, 1], [4560, 1], [5080, 1], [5500, -1], [6180, 1], [6780, 1], [7420, 1], [7700, -1], [8150, 1], [8320, 1], [9700, 1], [10030, -1]],
      pylons: [[3560, 1], [3900, 1], [7380, 1], [9400, -1], [5200, -1]],
      trees: [[5900, 1], [6350, -1], [4140, 1], [4210, 1], [8000, -1], [8250, -1], [1030, 1], [2300, 1], [2310, -1]],
      junction: 7063,            // Av. de l'Aérodrome : feux et tour de police (vidéo « de A à Z », 06:40)
    },
  },

  // Avenue de l'Université (tools/universite.py, OSM ; dossier « Université » : croquis du Rond-Point Ngaba, vidéos d'Ezo et de l'UNIKIN).
  // Construite dans la même scène que le trajet principal (voir `attachUni`). Rues, lieux, stations, arrêts, repères et routes du
  // repère de l'avenue (By Pass, Route de Kimwenza…) : data/universite.json, `extra`, ajouté ici par route.js.
  universite: {
    id: 'universite',
    title: "Avenue de l'Université",
    subtitle: 'Boulevard Sendwe → Rond-Point Ezo → Rond-Point Ngaba → UNIKIN',
    realKm: 9.75,
    data: 'data/universite.json',
    scale: 0.4,
    lanes: 1,
    twoLane: true,                // l'auteur, 07/11 : « juste une route de deux bandes, pas de bordure, juste le dessin aller et retour »
    shiftSeconds: 300,
    versement: 10000,
    fuelStart: 70,
    style: 'popular',
    separator: false,
    highwayUntil: 'UNIKIN',       // (ni bordure ni séparateur : on traverse partout)
    intro: "Avenue de l'Université : Rond-Point Ezo, Rond-Point Ngaba, puis l'UNIKIN.",
    start: 'attached',
    startSign: ["AVENUE DE L'UNIVERSITÉ", 'Ezo · Ngaba · UNIKIN ↑'],
    end: { kind: 'open', name: 'Université de Kinshasa', short: 'UNIKIN', trim: 14 },
    rivers: [],
    flyovers: [],
    footbridges: [],
    stations: [],
    crossings: [],
    greenMedianUntil: null,
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [],
    workers: [],
  },

  // Avenue Kasa-Vubu (tools/kasavubu.py, OSM) : du rond-point Kintambo Magasin au boulevard du 30 Juin (Gombe). L'auteur, 08/11 : « c'est juste un
  // boulevard à deux bandes sans bordures, juste des tracés ». Branchée au trajet principal au croisement Sendwe / Triomphal (Pont-Cabu) : main.js ROAD6.
  // Rues, lieux, stations, arrêts, repères, croisement et raccord (`kvJoin`) : `extra` de data/kasavubu.json.
  kasavubu: {
    id: 'kasavubu',
    title: 'Avenue Kasa-Vubu',
    subtitle: 'Kintambo Magasin → Bandal → Victoire → Pont-Cabu → Gombe',
    realKm: 12.56,
    data: 'data/kasavubu.json',
    scale: 0.4,
    lanes: 1,
    twoLane: true,
    shiftSeconds: 300,
    versement: 10000,
    fuelStart: 70,
    style: 'popular',
    separator: false,
    highwayUntil: 'Gombe',        // (ni bordure ni séparateur jusqu'au bout : juste le trait)
    intro: 'Avenue Kasa-Vubu : de Kintambo Magasin à la Gombe.',
    start: 'attached',
    startSign: ['AVENUE KASA-VUBU', 'Bandal · Victoire · Gombe ↑'],
    end: { kind: 'open', name: 'Boulevard du 30 Juin · Gombe', short: 'Gombe', trim: 0 },   // (tracé exact : il arrive au bord du 30 Juin)
    rivers: [],
    flyovers: [],
    footbridges: [],
    stations: [],
    crossings: [],
    greenMedianUntil: null,
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [],
    workers: [],
  },

  // By Pass (tools/bypass.py, OSM) : de l'entrée réservée à l'Échangeur à Cité Verte, par le Rond-Point Ngaba. Tracé en mètres de jeu dans la
  // scène (`exact`), construit dans la même scène que le trajet principal (voir `attachBp`). Rues, lieux, arrêts, repères et profil :
  // data/universite-like `extra` de data/bypass.json. L'auteur, 07/11 : jusqu'à l'entrée de Salongo, deux chaussées séparées par des bordures
  // et une pelouse où les gens attendent pour traverser (`pair`) ; ensuite, deux bandes sans bordure, juste le trait.
  bypass: {
    id: 'bypass',
    title: 'By Pass',
    subtitle: 'Échangeur → Salongo → Rond-Point Ngaba → Cité Verte',
    realKm: 14.1,
    data: 'data/bypass.json',
    scale: 0.4,
    lanes: 1,
    twoLane: true,
    shiftSeconds: 400,
    versement: 10000,
    fuelStart: 70,
    style: 'popular',
    separator: false,
    highwayUntil: 'Cité Verte',
    intro: 'By Pass : Salongo, le Rond-Point Ngaba, Kimwenza, puis Cité Verte.',
    start: 'attached',
    startSign: ['BY PASS', 'Salongo · Ngaba · Cité Verte ↑'],
    end: { kind: 'open', name: 'Cité Verte', short: 'Cité Verte', trim: 14 },
    rivers: [],
    flyovers: [],
    footbridges: [],
    stations: [],
    crossings: [],
    greenMedianUntil: null,
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [],
    workers: [],
  },

  // Rocade Sud-Est (tools/rocade.py) : de l'UNIKIN (bord de l'avenue de l'Université, avant le portail) par Kimwenza, Bralima, Riflard, le rail,
  // N'djili Brasserie, Cecomaf et Buma jusqu'au boulevard Lumumba près de l'aéroport. L'auteur, 09/11 : « rettape moi cette route, respecte bien
  // les images ; c'est une nouvelle route ; les kadafi et trois stations ». Vidéos du dossier « route rocade » (regardées seulement comme modèle) :
  // 2 × 2 voies sans terre-plein, double ligne blanche, caniveaux en U, talus de terre rouge, tranchées aux pentes couvertes d'une grille de béton.
  // Tracé en mètres de jeu dans la scène (`exact`) ; rues, lieux, stations, kadafi, arrêts, tranchées (`rocCuts`) : `extra` de data/rocade.json.
  // Première Entrée de N'djili → Rocade (tools/mamamobutu.py, OSM) : l'auteur, 09/11 : « ce même route est aussi attachée au boulevard Lumumba par
  // la première entrée de N'djili qui est reliée à la route de Cecomaf ». OSM : Route Mama Mobutu (de Lumumba, juste avant le Pont N'djili, vers le
  // sud), puis Route de Nsanda jusqu'à Cecomaf, où passe la Rocade. Deux bandes sans bordure, comme l'avenue Kasa-Vubu. Tracé exact dans la scène :
  // début au bord gauche du boulevard Lumumba (entrée « PREMIÈRE ENTRÉE »), bout au bord gauche de la Rocade (entrée « ROUTE DE NSANDA »).
  mamamobutu: {
    id: 'mamamobutu',
    title: "Première Entrée · Route de Nsanda",
    subtitle: "Boulevard Lumumba (Pont N'djili) → Route Mama Mobutu → Route de Nsanda → Rocade (Cecomaf)",
    realKm: 4.6,
    data: 'data/mamamobutu.json',
    scale: 0.4,
    lanes: 1,
    twoLane: true,
    shiftSeconds: 300,
    versement: 10000,
    fuelStart: 70,
    style: 'popular',
    separator: false,
    highwayUntil: 'Rocade',
    intro: "Première Entrée de N'djili : la Route Mama Mobutu puis la Route de Nsanda, jusqu'à la Rocade à Cecomaf.",
    start: 'attached',
    startSign: ['PREMIÈRE ENTRÉE', "N'djili · Cecomaf · Rocade ↑"],
    end: { kind: 'open', name: 'Rocade Sud-Est · Cecomaf', short: 'Rocade', trim: 0 },
    rivers: [],
    flyovers: [],
    footbridges: [],
    stations: [],
    crossings: [],
    greenMedianUntil: null,
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [],
    workers: [],
  },

  rocade: {
    id: 'rocade',
    title: 'Rocade Sud-Est',
    subtitle: 'UNIKIN → Kimwenza → Cecomaf → Buma → Boulevard Lumumba (aéroport)',
    realKm: 34.1,
    data: 'data/rocade.json',
    scale: 0.4,
    lanes: 2,
    rocade: true,                 // (world.js : double ligne au milieu, caniveaux en U, tranchées, maisons éparses)
    shiftSeconds: 800,
    versement: 10000,
    fuelStart: 70,
    style: 'popular',
    separator: false,
    highwayUntil: 'Boulevard Lumumba',
    intro: 'Rocade Sud-Est : Kimwenza, Cecomaf, Buma, puis le boulevard Lumumba près de l\'aéroport.',
    start: 'attached',
    startSign: ['ROCADE SUD-EST', 'Kimwenza · Cecomaf · Buma · Aéroport ↑'],
    end: { kind: 'open', name: 'Boulevard Lumumba · Aéroport', short: 'Lumumba', trim: 0 },   // (tracé exact : il arrive au bord du boulevard)
    rivers: [],
    flyovers: [],
    footbridges: [],
    stations: [],
    crossings: [],
    greenMedianUntil: null,
    guardrails: [],
    dense: [],
    market: null,
    busParks: [],
    tallNearEnd: 0,
    cranes: false,
    monuments: [],
    workers: [],
  },

  '30juin': {
    id: '30juin',
    title: 'Boulevard du 30 Juin',
    subtitle: 'Rond-point Kintambo Magasin → Socimat → Mandela → Gare Centrale',
    realKm: 7.62,
    jams: [[150, 7500, 1]],        // (l'auteur, 08/11) embouteillages sur tout le boulevard du 30 Juin
    traffic: {
      our: [
        'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi',
        'bus', 'bus', 'bus', 'bus', 'bus', 'bus', 'bus', 'bus',
        'city', 'city', 'city', 'edv', 'edv', 'van', 'van',
        'car', 'car', 'car', 'car', 'car', 'car', 'car', 'car', 'car', 'car',
        'police', 'police', 'amb', 'truck', 'truck', 'keke', 'keke', 'keke',
        'moto', 'moto', 'moto', 'moto', 'moto', 'moto', 'moto',
      ],
      onc: [
        'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi',
        'bus', 'bus', 'bus', 'bus', 'bus', 'bus', 'bus',
        'city', 'city', 'edv', 'van', 'van',
        'car', 'car', 'car', 'car', 'car', 'car', 'car', 'car',
        'police', 'police', 'amb', 'truck', 'truck', 'keke', 'keke',
        'moto', 'moto', 'moto', 'moto', 'moto',
      ],
    },
    data: 'data/30juin.json',
    scale: 0.7,                   // 7,62 km réels → ~5,33 km de jeu
    lanes: 4,
    shiftSeconds: 420,
    versement: 15000,
    fuelStart: 80,
    style: 'downtown',            // Kintambo → Mondjiba → Boulevard du 30 Juin (Gombe) → Gare Centrale
    intro: 'Rond-point Kintambo Magasin. Prends l\'avenue Colonel Mondjiba puis le boulevard du 30 Juin jusqu\'à la Gare centrale.',
    start: 'junction',
    startSign: ['AV. COLONEL MONDJIBA · BD DU 30 JUIN', 'Socimat · Mandela · Gare Centrale ↑'],
    end: { kind: 'junction', name: 'Place de la Gare Centrale', short: 'Gare Centrale', trim: 45 },
    landmarks: [
      ['Rond-point Kintambo Magasin', 'Kintambo', 0],
      ['École Rév. Kim · Komoriko', 'Komoriko', 620, true],
      ['GGmart Hyper · Pont Basoko', 'GGmart', 1289, true],
      ['Utexafrica · JAC Motors', 'Utexafrica', 1950, true],
      ['Rond-point Socimat', 'Socimat', 2501],
      ['Avenue des Batetela', 'Batetela', 3099, true],
      ['Hôtel du Gouvernement', 'Gouvernement', 3585],
      ['Rond-point Mandela', 'Mandela', 4377],
      ['Kin Plaza Arjaan by Rotana', 'Rotana', 5080, true],
      ['Hôtel Believe · Sabena', 'Believe', 5290, true],
      ['REGIDESO · Av. des Huileries', 'REGIDESO', 5860],
      ['La Poste (SCPT)', 'La Poste', 6637],
      ['Tour SOZACOM · Équateur', 'SOZACOM', 6860, true],
      ['Hôtel Memling · Tour BCDC', 'BCDC · Memling', 7160],
      ['Grande Roue · Gare Centrale', 'Grande Roue', 7510, true],
    ],
    rivers: [
      ['Rivière Makelele · Basoko', 1367, 16, 'Pont Mondjiba'],
      ['Rivière Gombe', 2635, 14, 'Pont Gombe'],
    ],
    flyovers: [
      { name: 'Socimat', s0: 2360, s1: 2620, title: 'SAUT-DE-MOUTON SOCIMAT', sub: 'Gauche : direct Bd du 30 Juin · Droite : Rond-point Socimat', look: 'asanef' },
      // (l'auteur, 08/11 : « c'est juste un saute-mouton sans séparateur, juste deux bandes » : au milieu, deux lignes peintes)
      { name: 'Mandela', s0: 4210, s1: 4560, title: 'SAUT-DE-MOUTON MANDELA', sub: 'Gauche : direct Gare Centrale · Droite : Rond-point Mandela', look: 'asanef', noSeparator: true },
    ],
    footbridges: [],
    busStops: [180, 860, 1890, 3150, 3950, 4850, 5600, 6280, 6660, 7280],
    stations: [
      ['Station Cobil Kintambo', 115],
      ['Station Engen Komoriko', 788],
      ['Station Cobil Mondjiba', 1950],
    ],
    crossings: [
      [3099, 'Av. des Batetela'],
      [3638, 'Place Royal · Gouvernement'],
      [3892, 'Av. des Palmiers'],
      [5085, 'Av. de la Justice · Rotana'],
      [5355, 'Av. Mbuji-Mayi'],
      [5937, 'Av. des Huileries · REGIDESO'],
      [6562, 'Av. Kasa-Vubu · Gombe'],
      [6937, "Av. de l'Équateur · SOZACOM"],
      [7246, 'Place du 27 Octobre · BCDC'],
    ],
    greenMedianUntil: null,
    barrierLen: 9,                // longs segments rouges et blancs (séparateur bas DBA du Bd du 30 Juin)
    guardrails: [],
    dense: [['Kintambo', 140], ['Komoriko', 90]],
    market: null,
    busParks: ['Kintambo'],
    tallNearEnd: 2400,
    cranes: true,
    trees: 4150,                  // grands arbres et murs blancs d'ambassades sur Mondjiba et l'ouest de la Gombe
    monuments: [
      { kind: 'gare', s: 7615, side: -1, name: 'GARE CENTRALE DE KINSHASA' },
    ],
    workers: [2850, 4900, 6800],
    sideRoads: [
      // 1. Rond-point Kintambo Magasin & Avenue Colonel Mondjiba (s = 0 → 2501 m)
      // (l'auteur, 08/11 : à 25 m, l'entrée était contre l'immeuble rond de Kintambo Magasin, et l'avenue Kasa-Vubu y arrivait dedans)
      // (l'auteur, 09/11 : « ces boulevards ne sont pas bien attachés » : à 105 m, l'avenue longeait l'immeuble rond et la rue Nguma ; ici, la place est libre)
      { s: 380, side: 1, name: 'AVENUE KASA-VUBU', sub: 'Rond-point Kintambo Magasin · Bandal', w: 10, kv: true },   // (kv : pas dessinée quand la vraie avenue est chargée)
      { s: 28, side: -1, name: 'AV. DES ÉCURIES · MONTAGNE', sub: 'Kintambo · Ngaliema', w: 10 },
      { s: 65, side: 1, name: 'AVENUE NGUMA', sub: 'Kintambo', w: 9 },
      { s: 68, side: -1, name: 'AVENUE DU FLEUVE', sub: 'Kintambo', w: 7.5 },
      { s: 150, side: 1, name: 'AVENUE BOBOLIKO', sub: 'Kintambo', w: 7.5 },
      { s: 222, side: -1, name: 'AVENUE DU PARC', sub: 'Ngaliema', w: 7.5 },
      { s: 472, side: -1, name: "AVENUE DE L'AVENIR", sub: 'Basoko · Ngaliema', w: 7.5 },
      { s: 489, side: 1, name: 'AVENUE DE LA FERME', sub: 'Kintambo · Ngaliema', w: 7.5 },
      { s: 750, side: -1, name: "AVENUE DE L'ÉTAT-MAJOR", sub: 'Camp Badiadingi · Ngaliema', w: 8 },
      { s: 813, side: 1, name: 'AVENUE KOMORIKO', sub: 'Station Engen · Kintambo', w: 9 },
      { s: 1767, side: 1, name: 'AVENUE MASSAMBA', sub: 'Grande Mosquée · Basoko', w: 8 },
      { s: 1817, side: 1, name: 'AVENUE TISSAKIN', sub: 'Basoko · Ngaliema', w: 7.5 },
      { s: 1835, side: -1, name: 'ENTRÉE UTEXAFRICA', sub: 'Concession Utex · Gombe', w: 8 },
      // 2. Rond-point Socimat → Rond-point Mandela (s = 2501 → 4377 m)
      { s: 2506, side: 1, name: 'AVENUE SERGENT MOKE', sub: 'Rond-point Socimat · Vers 24 Novembre', w: 11 },
      { s: 2506, side: -1, name: "AVENUE DE L'OUA · SOCIMAT", sub: 'Rond-point Socimat · Ngaliema', w: 11 },
      { s: 3099, side: -1, name: 'AVENUE DES BATETELA', sub: 'Tour Batetela · Ambassades · Gombe', w: 10 },
      { s: 3099, side: 1, name: 'AV. DES BATETELA (SUD)', sub: 'Mémorial L.-D. Kabila · Gombe', w: 10 },
      { s: 3560, side: 1, name: 'AV. KALUME MWANA KAHAMBWA', sub: 'Place Royal · Résidence 165', w: 8.5 },
      { s: 3638, side: -1, name: 'PLACE ROYAL · GOUVERNEMENT', sub: 'Hôtel du Gouvernement · TMB', w: 9 },
      { s: 3715, side: 1, name: 'AVENUE KAWUKA', sub: 'Gombe', w: 7.5 },
      { s: 3892, side: 1, name: 'AVENUE DES PALMIERS', sub: 'Gombe', w: 8 },
      { s: 4228, side: 1, name: 'AVENUE DES FORCES ARMÉES', sub: 'Afriland First Bank · Gombe', w: 9 },
      { s: 4248, side: -1, name: 'AV. DES FORCES ARMÉES (NORD)', sub: 'Polyclinique SNEL · Gombe', w: 8.5 },
      // 3. Rond-point Mandela → Place de la Gare Centrale (s = 4377 → 7621 m)
      { s: 4377, side: 1, name: 'AV. DE LA LIBÉRATION (24 NOV.)', sub: 'ISC · Kinshasa Mall · Camp Kokolo · Triomphal', w: 31, len: 90 },
      { s: 4377, side: -1, name: 'AV. DE LA LIBÉRATION (NORD)', sub: 'Rond-point Mandela · Gombe', w: 12 },
      { s: 4584, side: 1, name: 'AVENUE DES JACARANDAS', sub: 'Immeuble Matrix · Gombe', w: 8 },
      { s: 4683, side: 1, name: 'AVENUE DU CERCLE', sub: 'Ambassade de Tunisie · Gombe', w: 8.5 },
      { s: 4683, side: -1, name: 'AVENUE DU CERCLE (NORD)', sub: 'Clinique Ngaliema · Gombe', w: 8.5 },
      { s: 4791, side: 1, name: 'AVENUE DES ÉTOILES', sub: 'Gombe', w: 8 },
      { s: 4791, side: -1, name: 'AV. DES ÉTOILES (NORD)', sub: 'Collège Les Saphirs · Gombe', w: 8 },
      { s: 4966, side: -1, name: 'AVENUE KILO-MOTO', sub: 'Gombe', w: 8 },
      { s: 5085, side: -1, name: 'AVENUE DE LA JUSTICE', sub: 'Kin Plaza Arjaan by Rotana · Gombe', w: 9 },
      { s: 5192, side: 1, name: 'AVENUE KATANGA', sub: 'Gombe', w: 8 },
      { s: 5355, side: -1, name: 'AVENUE MBUJI-MAYI', sub: 'Hôtel Believe · Gombe', w: 8.5 },
      { s: 5714, side: 1, name: 'AVENUE DE LA T.S.F.', sub: 'Chancellerie des Ordres Nationaux', w: 8 },
      { s: 5937, side: 1, name: 'AVENUE DES HUILERIES', sub: 'REGIDESO · Lingwala', w: 11 },
      { s: 5937, side: -1, name: 'AV. DES HUILERIES (NORD)', sub: 'MONUSCO · Golf · Gombe', w: 10 },
      { s: 6156, side: 1, name: 'AVENUE WANGATA', sub: 'Centre Gécamines · Gombe', w: 8.5 },
      { s: 6196, side: -1, name: 'AVENUE NGONGO LUTETE', sub: 'Supermarché Régal · Gombe', w: 8.5 },
      { s: 6398, side: -1, name: 'AVENUE DU BANDUNDU', sub: 'Centre Médical Diamant · Gombe', w: 8.5 },
      { s: 6398, side: 1, name: 'AVENUE MPOLO', sub: 'Gombe', w: 8.5 },
      { s: 6562, side: 1, name: 'AVENUE KASA-VUBU (GOMBE)', sub: 'Ecobank · La Poste', w: 10, kv: true },
      { s: 6720, side: 1, name: 'AVENUE DU MARCHÉ', sub: 'Grand Marché · Gombe', w: 8.5 },
      { s: 6723, side: -1, name: 'AVENUE DU PORT', sub: 'Police de Roulage · Gombe', w: 8.5 },
      { s: 6937, side: -1, name: "AVENUE DE L'ÉQUATEUR", sub: 'Gombe', w: 9 },
      { s: 6937, side: 1, name: "AV. DE L'ÉQUATEUR (SUD)", sub: 'Tour SOZACOM · Délégation UE', w: 9 },
      { s: 7000, side: -1, name: 'AVENUE MUTOMBO KATSHI', sub: 'Gombe', w: 8.5 },
      { s: 7009, side: 1, name: 'AVENUE DU TCHAD · PLATEAU', sub: 'Hôtel Memling · Gombe', w: 9 },
      { s: 7119, side: -1, name: 'AVENUE IPENGE', sub: 'Tour Equity BCDC · Gombe', w: 8 },
      { s: 7119, side: 1, name: 'AVENUE IPENGE (SUD)', sub: 'Hôtel Memling · Gombe', w: 8 },
      { s: 7246, side: -1, name: 'PLACE DU 27 OCTOBRE', sub: 'Tour BCDC · Gombe', w: 9.5 },
      { s: 7244, side: 1, name: 'AVENUE DE LA PRESSE', sub: 'Palais de la Justice · Botour', w: 8.5 },
      { s: 7367, side: -1, name: 'AVENUE DONGO', sub: 'Gombe', w: 8 },
      { s: 7368, side: 1, name: 'AVENUE LUAMBO MAKIADI', sub: 'ex-Bokassa · Kin-Mazière', w: 10 },
      { s: 7580, side: 1, name: 'AVENUE DU KASAÏ', sub: 'Place de la Gare · Gombe', w: 9.5 },
      { s: 7585, side: -1, name: 'AVENUE DES AVIATEURS', sub: 'Grande Roue · Place de la Gare', w: 9.5 },
    ],
    places: [
      // 1. Kintambo Magasin → Socimat (Avenue Colonel Mondjiba, vidéo 01:14 → 09:40)
      { kind: 'b30_kintambo', s: 42, side: 1, name: 'ROND-POINT KINTAMBO MAGASIN', sub: 'Immeuble Vitré · KSC · Kitambo Mall' },
      { kind: 'orange_shop', s: 134, side: 1 },
      { kind: 'commercial', s: 162, side: -1, name: 'KITAMBO MALL · KSC', sub: 'Hasson & Frères · Supermarché', color: 0x222831, accent: 0xf5c400 },
      { kind: 'commercial', s: 276, side: 1, name: 'AMBASSADE DU GABON', sub: 'Avenue Colonel Mondjiba', color: 0xf0ece1, accent: 0x1d6b3a },
      { kind: 'school', s: 523, side: -1, name: 'COLLÈGE SAINTE CLAIRE II', sub: 'Avenue Colonel Mondjiba · Ngaliema' },
      { kind: 'b30_rev_kim', s: 620, side: 1, name: 'ÉCOLE RÉV. KIM', sub: 'Complexe Scolaire · Kintambo' },
      { kind: 'b30_mural', s: 695, side: -1 },                                  // Fresque murale marine bleue (vidéo 04:18)
      { kind: 'commercial', s: 1059, side: 1, name: 'VFDRC · VISIONFUND', sub: 'Microfinance · Mondjiba', color: 0xf2efe8, accent: 0xe65100 },
      { kind: 'b30_ggmart', s: 1289, side: -1, name: 'GGmart HYPERMARKET', sub: 'Centre Commercial · Basoko · Mondjiba' },
      { kind: 'mosque', s: 1672, side: 1, name: 'GRANDE MOSQUÉE DE KINSHASA', sub: 'Avenue Colonel Mondjiba' },
      { kind: 'commercial', s: 1830, side: -1, name: 'S&K UTEX AFRICA · RAWBANK', sub: 'Concession Utexafrica · Mondjiba', color: 0xf4f2ec, accent: 0x1d4fa0 },
      { kind: 'b30_chantier', s: 1995, side: 1, floors: 8, netted: false },    // Immeuble R+8 en chantier (vidéo 07:51)
      { kind: 'b30_jac', s: 2090, side: 1, name: 'JAC MOTORS · JETO', sub: 'Concessionnaire Automobile · Mondjiba' },
      { kind: 'commercial', s: 2185, side: 1, name: 'IL MERCATO · EQUITY BANK', sub: 'Centre Médical Diamant · Mondjiba', color: 0xeae6dc, accent: 0x9e2835 },
      { kind: 'commercial', s: 2341, side: -1, name: 'AMBASSADE DE FRANCE', sub: 'Avenue Colonel Mondjiba · Socimat', color: 0xf5f3ed, accent: 0x0b4f9c },
      // 2. Rond-point Socimat → Rond-point Mandela (Boulevard du 30 Juin Ouest, vidéo 09:50 → 14:40)
      { kind: 'vodacom_shop', s: 2675, side: -1 },
      { kind: 'commercial', s: 2710, side: 1, name: 'IMMEUBLE SOCIMAT · GOMBE', sub: 'Boulevard du 30 Juin', color: 0xcfe2f3, accent: 0x1d4fa0 },
      { kind: 'b30_batetela', s: 3060, side: -1, name: 'TOUR BATETELA', sub: 'Avenue des Batetela · Gombe' },
      { kind: 'b30_cnss_glass', s: 3148, side: -1, name: 'IMMEUBLE CNSS · BCDC', sub: 'Boulevard du 30 Juin · Batetela' },
      { kind: 'commercial', s: 3195, side: 1, name: 'MÉMORIAL L.-D. KABILA · AMB. ANGOLA', sub: 'Ambassade du Congo · Gombe', color: 0xf2efe8, accent: 0x8e2b2b },
      { kind: 'commercial', s: 3380, side: -1, name: 'AMBASSADE DE TANZANIE · BIC', sub: 'Boulevard du 30 Juin · Gombe', color: 0xf4f0ea, accent: 0x1d6b3a },
      { kind: 'b30_res165', s: 3525, side: 1, name: 'RÉSIDENCE 165', sub: 'Hôtel & Restaurant · Place Royal' },
      { kind: 'b30_gouvernement', s: 3590, side: -1, name: 'HÔTEL DU GOUVERNEMENT', sub: 'Immeuble Intelligent · TMB · Place Royal' },
      { kind: 'b30_white_tower', s: 3745, side: 1, name: 'TOUR ROYAL GOMBE', sub: 'Boulevard du 30 Juin' },
      { kind: 'b30_3pillars', s: 3825, side: 1, name: 'IMMEUBLE DES PALMIERS', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'commercial', s: 3875, side: -1, name: 'BGFIBank · AMBASSADE DU LIBAN', sub: 'Boulevard du 30 Juin · Gombe', color: 0xe8edf2, accent: 0x0b4f9c },
      { kind: 'b30_copper_glass', s: 4085, side: -1, name: 'QUANTUM · FIBANK TOWER', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'b30_africell_tower', s: 4148, side: 1, name: 'TOUR AFRICELL · RAWBANK', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'b30_afriland', s: 4202, side: 1, name: 'AFRILAND FIRST BANK CD', sub: 'Direction Générale · Bd du 30 Juin' },
      // 3. Rond-point Mandela → Place de la Gare Centrale (Boulevard du 30 Juin Est, vidéo 14:40 → 25:15)
      { kind: 'b30_matrix', s: 4615, side: 1, name: 'IMMEUBLE MATRIX · LC WAIKIKI', sub: 'Avenue des Jacarandas · Gombe' },
      { kind: 'b30_mandela_apt', s: 4610, side: -1, name: 'RÉSIDENCE MANDELA', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'commercial', s: 4725, side: 1, name: 'HÔTEL AFRICAN DREAM · TUNISIE', sub: 'Avenue du Cercle · Gombe', color: 0xd96b43, accent: 0x222831 },
      { kind: 'commercial', s: 4758, side: -1, name: 'FBNBank · AFRICELL', sub: 'Boulevard du 30 Juin · Gombe', color: 0xd86038, accent: 0x0b4f9c },
      { kind: 'school', s: 4835, side: -1, name: 'COLLÈGE LES SAPHIRS · FNUAP', sub: 'Ambassade Union Africaine · Gombe' },
      { kind: 'b30_rotana', s: 5080, side: -1, name: 'KIN PLAZA ARJAAN BY ROTANA', sub: 'Premier Shopping Mall · CityMarket · Okaïdi' },
      { kind: 'b30_chantier', s: 5215, side: -1, floors: 11, netted: true },   // Tour R+11 sous filet vert (vidéo 16:06)
      { kind: 'b30_believe', s: 5290, side: -1, name: 'HÔTEL BELIEVE · BRUSSELS AIRLINES', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'b30_sabena', s: 5490, side: -1, name: 'IMMEUBLE SABENA · MINISTÈRES', sub: 'Galeries du 30 Juin · Gombe' },
      { kind: 'church', s: 5465, side: 1, name: 'ÉGLISE ORTHODOXE · CERCLE HELLÉNIQUE', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'b30_orange_tower', s: 5665, side: 1, name: 'IMMEUBLE ORANGE RDC', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'b30_chancellerie', s: 5755, side: 1, name: 'CHANCELLERIE DES ORDRES NATIONAUX', sub: 'République Démocratique du Congo' },
      { kind: 'b30_regideso', s: 5860, side: -1, name: 'REGIDESO SA', sub: 'Direction Générale · Bd du 30 Juin' },
      { kind: 'b30_chantier', s: 5885, side: 1, floors: 12, netted: true },    // Grand chantier sous filet vert + grue (vidéo 17:54)
      { kind: 'commercial', s: 5985, side: 1, name: 'EQUITY BANK · TERRASSE CRYSTAL', sub: 'Carrefour des Huileries · 30 Juin', color: 0xf2efe6, accent: 0x9e2835 },
      { kind: 'commercial', s: 6060, side: -1, name: 'TMB BOULEVARD · RÉGAL', sub: 'Supermarché · Bd du 30 Juin', color: 0xeae4d7, accent: 0xd62828 },
      { kind: 'kinmarche', s: 6280, side: 1 },
      { kind: 'b30_dentisterie_chantier', s: 6450, side: -1, name: 'CENTRE MÉDICAL DIAMANT · BOA', sub: 'Bank of Africa · Bd du 30 Juin' },
      { kind: 'b30_blue_curve', s: 6470, side: 1, name: 'TOUR BLEUE · ECOBANK', sub: 'Carrefour Kasa-Vubu · Gombe' },
      { kind: 'b30_scpt', s: 6637, side: 1, name: 'SCPT · LA GRANDE POSTE', sub: 'Société Commerciale des Postes et Télécommunications' },
      { kind: 'b30_sozacom', s: 6860, side: 1, name: 'TOUR SOZACOM · EQUITY BCDC', sub: "Avenue de l'Équateur · Gombe" },
      { kind: 'commercial', s: 6955, side: 1, name: 'DÉLÉGATION UNION EUROPÉENNE', sub: 'Boulevard du 30 Juin · Gombe', color: 0xf0ede6, accent: 0x003399 },
      { kind: 'b30_solenac', s: 7060, side: -1, name: 'SOLENAC · SUPERMARCHÉ', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'b30_memling', s: 7129, side: 1, name: 'HÔTEL MEMLING', sub: 'Avenue du Tchad · Gombe' },
      { kind: 'b30_bcdc_tower', s: 7165, side: -1, name: 'TOUR EQUITY BCDC', sub: 'Siège Social · Place du 27 Octobre' },
      { kind: 'b30_palais_justice', s: 7275, side: 1, name: 'PALAIS DE LA JUSTICE · BOTOUR', sub: 'Boulevard du 30 Juin · Gombe' },
      { kind: 'airtel_shop', s: 7315, side: -1 },
      { kind: 'b30_bold_chantier', s: 7420, side: 1, name: 'IMMEUBLE BOLD · AGUA', sub: 'Grands Panneaux · Place de la Gare' },
      { kind: 'b30_ferris_wheel', s: 7510, side: -1, name: 'LA GRANDE ROUE DE KINSHASA', sub: 'Parc d\'Attraction · Place de la Gare Centrale' },
    ],
    // Liaison avec l'avenue de la Libération (ex-24 Novembre) : en s'engageant dans son entrée au Rond-point Mandela, on
    // passe sur le trajet principal, sur le 24 Novembre vers Asanef et le Triomphal (voir `links` du trajet lumumba)
    links: [{ to: 'lumumba', at: 'sideRoad', road: 4377, side: 1, s: 23930, dir: -1, name: 'Avenue de la Libération (ex-24 Novembre)' }],
  },
};

// ---------- Le 24 Novembre attaché au vrai Boulevard du 30 Juin ----------
// Une seule route, sans chargement : le trajet « Boulevard du 30 Juin » (Kintambo Magasin → Place de la Gare) est
// construit tel quel dans la même scène, posé de façon que son entrée « Av. de la Libération (24 Nov.) » (s = 4 377 m,
// à droite) prolonge exactement le bout du 24 Novembre (voir main.js, ATT). La chaussée du 24 Novembre s'arrête à
// `join` m de jeu du bord du Boulevard du 30 Juin, au bout de cette entrée ; au carrefour on tourne à gauche (Socimat,
// Kintambo) ou à droite (Gare Centrale, arrivée de la journée).
{
  const L = ROUTES.lumumba, X = L.ext, LUM_OSM_LEN = 12686;      // (longueur de data/lumumba.json)
  L.attach = { route: '30juin', road: 4377, side: 1, join: 84 };
  L.attachBp = { route: 'bypass' };                               // (By Pass : voir main.js, ROAD5)
  L.attachUni = { route: 'universite' };                         // (Avenue de l'Université : voir main.js, ROAD4)
  L.attachPL = { route: 'poidslourds' };                         // (Route Poids Lourds : voir main.js, ROAD3)
  L.attachKv = { route: 'kasavubu' };                            // (Avenue Kasa-Vubu : voir main.js, ROAD6)
  const ROC_S4 = 9370;                                           // (avenue de l'Université : 60 m de jeu avant le portail de l'UNIKIN, z ≈ -3 748)
  L.attachRoc = { route: 'rocade' };                             // (Rocade Sud-Est : voir main.js, ROAD7)
  L.attachMm = { route: 'mamamobutu' };                          // (Première Entrée → Rocade à Cecomaf : voir main.js, ROAD8)
  // entrées de la Rocade : à gauche du boulevard Lumumba, 900 m après l'aérogare ; à droite de l'avenue de l'Université, avant le portail de l'UNIKIN
  // (roc : pas dessinées quand la vraie Rocade est chargée ; elle arrive au même endroit)
  L.sideRoads.push({ s: 900, side: -1, name: 'ROCADE SUD-EST', sub: 'Buma · Cecomaf · Kimwenza', w: 17, roc: true });
  ROUTES.universite.moreSideRoads = [{ s: ROC_S4, side: 1, name: 'ROCADE SUD-EST', sub: 'Kimwenza · Cecomaf · Aéroport', w: 17, roc: true }];
  const END_EXT = 6450;                                          // bout du 24 Novembre (m réels après la fourche Sendwe)
  X.streets = X.streets.filter(r => r.s < END_EXT - 20);
  X.places = X.places.filter(p => (p.s ?? p.s0 ?? 0) < END_EXT - 20);
  L.landmarks = L.landmarks.filter(([, , s]) => s < X.from + END_EXT - 20);
  L.busStops = L.busStops.filter(s => s < X.from + END_EXT - 40);
  L.end.trim = Math.round(LUM_OSM_LEN * L.scale) - Math.round((X.from + END_EXT) * L.scale);
}

// Trajet « Aéroport → Limete 1re Rue » : le décor du trajet principal, départ devant l'aérogare, arrivée à la 1re Rue
// (finish : arrivée avant la fin du décor ; les clients et la barre de trajet s'arrêtent là)
ROUTES.aeroport = {
  ...ROUTES.lumumba,
  id: 'aeroport',
  title: 'Boulevard Lumumba',
  subtitle: "Aéroport de N'djili → Masina → Échangeur → Limete 1re Rue",
  realKm: 17.2,
  shiftSeconds: 620,            // 06:00 → 18:00 sur 17,2 km
  intro: "06:00, aéroport de N'djili. Un voyageur attend devant : arrête-toi dans la zone jaune.",
  startAt: 'airport',
  attach: null,                 // (pas de Boulevard du 30 Juin sur ce trajet)
  attachPL: null,
  attachUni: null,
  attachBp: null,
  attachKv: null,
  attachRoc: null,
  attachMm: null,
  finish: { s: 17172, name: 'Limete 1re Rue', short: '1re Rue' },
};
// Ordre des trajets dans le menu
export const MENU = ['aeroport', 'lumumba', '30juin', 'triomphal'];

// (une seconde copie de ce fichier, chargée avec ?route=…, décrit le trajet attaché : voir l'importmap de index.html)
export const ROUTE_ID = new URL(import.meta.url).searchParams.get('route') ?? new URLSearchParams(location.search).get('route');
export const CURRENT = ROUTES[ROUTE_ID] ?? ROUTES.lumumba;
/** Cette copie des modules décrit-elle un trajet attaché au trajet principal (chargée avec ?route=…, voir main.js) ? */
export const ATTACHED = new URL(import.meta.url).searchParams.has('route');

// ---------- Itinéraires (l'auteur, 07/11) : le joueur choisit son véhicule, son itinéraire et son sens ; seules les routes de l'itinéraire sont chargées ----------
// route : trajet de la page (?route=) ; roads : trajets attachés à charger (30juin, pl, uni, bp). A et B : départ et arrivée de l'aller (le retour va de B à A).
// road : 1 (trajet de la page), 2 (30 Juin), 4 (avenue de l'Université), 5 (By Pass) ; s : abscisse du tracé (m réels) ou z : repère nommé ;
// dir : sens de la marche à ce point pendant l'aller (1 : vers la fin du tracé, chaussée de droite ; -1 : vers son début, chaussée de gauche).
const ROC_END = 48440;                                    // (tools/rocade.py : s du bout de la Rocade moins 100 m)
export const ITINERAIRES = [
  {
    id: 'aeroport-gare', code: 'L1', tag: 'Traversée Est–Ouest',
    title: 'Aéroport ↔ Gare Centrale',
    via: 'Bd Lumumba · Échangeur · Sendwe · 24 Novembre · Bd du 30 Juin',
    stops: ["Aéroport N'djili", 'Masina', 'Échangeur', '24 Novembre', 'Gare Centrale'],
    km: 26.8, route: 'lumumba', roads: ['30juin', 'pl'],
    A: { name: "Aéroport de N'djili", cri: 'Aéroport', road: 1, s: 45, dir: 1 },
    B: { name: 'Gare Centrale · Bd du 30 Juin', cri: 'Gare', road: 2, at: 'plaza', dir: 1 },
    variants: [
      {
        id: 'limete-30juin', label: 'Via Limete · 24 Nov · 30 Juin', short: 'Limete · 24 Nov · 30 Juin',
        via: 'Bd Lumumba · Échangeur · Sendwe · 24 Novembre · Bd du 30 Juin',
        stops: ["Aéroport N'djili", 'Masina', 'Échangeur', '24 Novembre', 'Gare Centrale'],
        km: 26.8, roads: ['30juin', 'pl'],
        B: { name: 'Gare Centrale · Bd du 30 Juin', cri: 'Gare', road: 2, at: 'plaza', dir: 1 },
      },
      {
        id: 'poidslourds', label: 'Via Route Poids Lourds', short: 'Route Poids Lourds',
        via: 'Bd Lumumba · Pont Matete · Route Poids Lourds · Kingabwa · Gare Centrale',
        stops: ["Aéroport N'djili", 'Masina', 'Pont Matete', 'Poids Lourds', 'Gare Centrale'],
        km: 24.1, roads: ['30juin', 'pl'],
        B: { name: 'Gare Centrale · Poids Lourds', cri: 'Gare', road: 3, at: 'plaza', dir: 1 },
      },
    ],
  },
  {
    id: 'masina-limete', code: 'L2', tag: 'Axe Tshangu · Limete',
    title: 'Masina Q.3 · Kingasani ↔ 1re Rue',
    via: 'Masina Quartier 3 · Kingasani · Pont Matete · Échangeur · 1re Rue Limete',
    stops: ['Masina Q.3', 'Kingasani', "N'djili Q.1", 'Échangeur', '1re Rue Limete'],
    km: 12.8, route: 'lumumba', roads: [],
    // (l'auteur, 08/11 & 15/11 : aller Masina Quartier 3 → 1re Rue ; retour 1re Rue → Kingasani Maison communale, puis demi-tour à l'Entrée Siforco)
    A: { name: 'Masina Q.3 / Kingasani', cri: 'Kingasani', road: 1, s: 4910, dir: 1, startS: 4910, startName: 'Masina · Arrêt Quartier 3', endS: 4338, endName: 'Kingasani · Maison communale', turnS: 4128, turnName: 'Entrée Siforco' },
    B: { name: '1re Rue Limete', cri: 'Limete', road: 1, s: 17172, dir: 1 },
  },
  {
    id: 'universite', code: 'L3', tag: 'Axe Universitaire',
    title: "Avenue de l'Université",
    via: 'Boulevard Sendwe · Rond-Point Ezo · Rond-Point Ngaba · Campus UNIKIN',
    stops: ['Bd Sendwe', 'Rond-Point Ezo', 'Rond-Point Ngaba', 'Campus UNIKIN'],
    km: 9.7, route: 'universite', roads: [],
    A: { name: 'Boulevard Sendwe', cri: 'Sendwe', road: 1, s: 30, dir: 1 },
    B: { name: 'Campus UNIKIN', cri: 'UNIKIN', road: 1, at: 'campus', dir: 1 },
    variants: [
      {
        id: 'campus', label: 'Rond-Point & Campus UNIKIN', short: 'Campus UNIKIN',
        via: 'Boulevard Sendwe · Rond-Point Ezo · Rond-Point Ngaba · Campus UNIKIN',
        stops: ['Bd Sendwe', 'Rond-Point Ezo', 'Rond-Point Ngaba', 'Campus UNIKIN'],
        km: 9.7, roads: [],
        B: { name: 'Campus UNIKIN', cri: 'UNIKIN', road: 1, at: 'campus', dir: 1 },
      },
      {
        id: 'ngaba', label: 'Terminus Rond-Point Ngaba', short: 'Rond-Point Ngaba',
        via: 'Boulevard Sendwe · Kalamu · Rond-Point Ezo · Rond-Point Ngaba',
        stops: ['Bd Sendwe', 'Kalamu', 'Rond-Point Ezo', 'Rond-Point Ngaba'],
        km: 6.0, roads: [],
        B: { name: 'Rond-Point Ngaba', cri: 'Ngaba', road: 1, s: 5900, dir: 1 },
      },
    ],
  },
  {
    id: 'kingasani-ngaba', code: 'L4', tag: 'Rocade By Pass',
    title: 'Kingasani ↔ Rond-Point Ngaba',
    via: 'Kingasani · Boulevard Lumumba · Échangeur · By Pass · Lemba · Ngaba',
    stops: ['Kingasani', 'Pont Matete', 'Échangeur', 'By Pass', 'Rond-Point Ngaba'],
    km: 15.0, route: 'lumumba', roads: ['bp'],
    A: { name: 'Kingasani', cri: 'Kingasani', road: 1, s: 4910, dir: 1, startS: 4910, startName: 'Kingasani · Arrêt Quartier 3', endS: 4338, endName: 'Kingasani · Maison communale', turnS: 4128, turnName: 'Entrée Siforco' },
    B: { name: 'Rond-Point Ngaba', cri: 'Ngaba', road: 5, at: 'ngaba', dir: 1 },
  },
  {
    id: 'sendwe-30juin', code: 'L5', tag: 'Centre-Ville · Gombe',
    title: 'Sendwe ↔ Boulevard du 30 Juin',
    via: 'Fourche Sendwe · Bd Triomphal · 24 Novembre · Bd du 30 Juin · Gare Centrale',
    stops: ['Fourche Sendwe', 'Triomphal', '24 Novembre', 'Mandela', 'Gare Centrale'],
    km: 9.5, route: 'lumumba', roads: ['30juin'],
    A: { name: 'Fourche Sendwe', cri: 'Sendwe', road: 1, at: 'sendwe', dir: 1 },
    B: { name: 'Place de la Gare · Bd du 30 Juin', cri: 'Gare', road: 2, at: 'plaza', dir: 1 },
  },
  {
    id: 'rocade', code: 'L6', tag: 'Rocade Sud-Est',
    title: "Rocade (UNIKIN ↔ Q.1 / Aéroport)",
    via: "UNIKIN · Kimwenza · Cecomaf · Route Mama Mobutu · Quartier 1 N'djili",
    stops: ['UNIKIN', 'Kimwenza', 'Cecomaf', 'Mama Mobutu', "Quartier 1 N'djili"],
    km: 21.8, route: 'lumumba', roads: ['roc', 'mm'],
    A: { name: 'UNIKIN · Route de Kimwenza', cri: 'UNIKIN', road: 7, s: 60, dir: 1 },
    B: { name: "Quartier 1 · 1re Entrée N'djili", cri: "N'djili", road: 8, s: 45, dir: -1 },
    variants: [
      {
        id: 'quartier1', label: "Via Quartier 1 N'djili", short: "Quartier 1 N'djili",
        via: "UNIKIN · Kimwenza · Cecomaf · Route de Nsanda · Mama Mobutu · Quartier 1",
        stops: ['UNIKIN', 'Kimwenza', 'Cecomaf', 'Mama Mobutu', "Quartier 1 N'djili"],
        km: 21.8, roads: ['roc', 'mm'],
        B: { name: "Quartier 1 · 1re Entrée N'djili", cri: "N'djili", road: 8, s: 45, dir: -1 },
      },
      {
        id: 'aeroport', label: "Via Aéroport de N'djili", short: "Aéroport de N'djili",
        via: "UNIKIN · Kimwenza · Cecomaf · Buma · Boulevard Lumumba (Aéroport)",
        stops: ['UNIKIN', 'Kimwenza', 'Cecomaf', 'Buma', "Aéroport N'djili"],
        km: 34.1, roads: ['roc'],
        B: { name: "Boulevard Lumumba · Aéroport", cri: 'Aéroport', road: 7, s: ROC_END, dir: 1 },
      },
    ],
  },
  {
    id: 'kasavubu', code: 'L7', tag: 'Transversale Kasa-Vubu',
    title: 'Avenue Kasa-Vubu',
    via: 'Kintambo Magasin · Bandal · Rond-Point Victoire · Pont-Cabu · Gombe',
    stops: ['Kintambo Magasin', 'Bandal', 'Victoire', 'Pont-Cabu', 'Gombe · 30 Juin'],
    km: 12.6, route: 'lumumba', roads: ['kv'],
    A: { name: 'Rond-point Kintambo Magasin', cri: 'Kintambo', road: 6, s: 60, dir: 1 },
    B: { name: 'Gombe · Bd du 30 Juin', cri: 'Gombe', road: 6, s: 16060, dir: 1 },
  },
];
/** Les trois véhicules : prix du transport par client (FC), versement dû au patron (FC), places, vitesse (m/s), accélération, taille (m). */
export const VEHICULES = {
  berline: { name: 'Taxi berline', icon: '🚕', fare: 1500, versement: 100000, places: 4, max: 22, acc: 7.5, w: 1.8, l: 4.4, about: '4 places · équilibré' },
  bus: { name: 'Taxi-bus 207', icon: '🚐', fare: 500, versement: 200000, places: 10, max: 17, acc: 5, w: 2.05, l: 5.6, about: '10 places · lent et large' },
  moto: { name: 'Wewa (moto)', icon: '🏍️', fare: 1500, versement: 30000, places: 1, max: 25, acc: 9, w: 0.8, l: 2.1, about: '1 client · rapide, se faufile' },
  // (l'auteur, 10/11 : « une possibilité pour la voiture personnelle dont l'objectif serait de parcourir la ville, mais il doit choisir son itinéraire »)
  perso: { name: 'Voiture personnelle', icon: '🚗', fare: 0, versement: 0, places: 0, max: 24, acc: 8, w: 1.8, l: 4.4, about: 'Parcourir la ville · sans clients', perso: true },
};

/** Mode Course (l'auteur, 07/11 : « course de motos ou de taxi, le trajet est défini en avance et le gagnant a une somme ») : mise pour participer, prix du gagnant ;
 *  le 2e récupère sa mise. Les courses se font à l'aller, sur les itinéraires qui restent sur une seule route. */
export const COURSES = {
  berline: { mise: 10000, prix: 60000, rivals: ['Fiston', 'Gloire', 'Christian'] },
  moto: { mise: 5000, prix: 30000, rivals: ['Papy', 'Junior', 'Djodjo'] },
};
