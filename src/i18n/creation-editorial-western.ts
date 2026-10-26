import type { EditorialEdition } from './creation-editorial-types'

export const editorialWestern: Record<'fr' | 'id' | 'fil', EditorialEdition> = {
    fr: {
        guideIndex: {
            title: 'Guides de création vidéo IA : scénario, plans et personnages',
            description:
                'Apprenez à transformer un scénario en vidéo, préparer un storyboard manga, garder des personnages cohérents et animer une image avec makivue. Avec exemples écrits et listes de vérification.',
            heading: 'Préparez votre prochaine histoire, une décision à la fois',
            intro: 'Choisissez une étape de production. Chaque guide propose une méthode, un exemple écrit et des points à vérifier avant de générer des vidéos.',
            label: 'Guides de création IA',
            contents: 'Dans ce guide',
            example: 'Exemple écrit à adapter',
            faq: 'Questions sur cette méthode',
            related: 'Poursuivre la production',
            feature: 'Découvrir l’outil associé',
            action: 'Commencer la création',
            pricing: 'Consulter les tarifs des modèles',
            walkthrough: 'Lire le guide complet du studio',
            credits:
                'Les nouveaux comptes reçoivent 1 000 crédits à l’inscription. Chaque génération utilise des crédits selon le modèle et l’usage réel ; ce bonus ne garantit pas une vidéo ou une série complète.',
            updated: 'Mis à jour le',
            byline: 'Équipe éditoriale makivue'
        },
        toolIndex: {
            title: 'Outils IA pour images et vidéos : texte, références et mouvement',
            description:
                'Comparez les outils de génération d’images IA, texte vers image, image vers image, texte vers vidéo et image vers vidéo pour préparer votre histoire. Comparez les sources, modèles et usages possibles.',
            heading: 'Choisissez le point de départ de votre image ou vidéo',
            intro: 'Partez d’une description pour explorer une idée, d’une image pour développer un visuel, ou d’un scénario pour organiser plusieurs plans. Vérifiez la méthode avant d’ouvrir l’espace de création.',
            label: 'Outils de création d’images et vidéos IA',
            features: 'Ce que cette méthode permet de préparer',
            steps: 'De la source au résultat à vérifier',
            useCases: 'Des usages concrets pour commencer',
            example: 'Une consigne écrite à adapter',
            faq: 'Questions avant la génération',
            related: 'Explorer les méthodes associées',
            action: 'Ouvrir l’espace de création',
            pricing: 'Comparer les tarifs des modèles',
            guide: 'Lire le guide pratique',
            videoTool: 'Découvrir le générateur vidéo IA',
            dramaTool: 'Préparer une mini-série IA',
            credits:
                'Les nouveaux comptes reçoivent 1 000 crédits à l’inscription. La génération est facturée selon le modèle et l’usage réel ; ce bonus ne garantit pas une vidéo ou une série complète.',
            compare: 'Comparer les sources de départ'
        },
        guides: {
            'script-to-video': {
                title: 'Du scénario à la vidéo IA : préparer un court récit',
                description:
                    'Transformez un scénario ou un extrait de roman en plans : personnages, décors, storyboard et clips pour un court récit avec makivue. Suivez un exemple de scène en trois plans.',
                keywords: ['scénario vers vidéo IA', 'roman en vidéo', 'générateur de court métrage IA', 'histoire en vidéo', 'tutoriel scénario vers vidéo', 'adaptation de roman IA'],
                heading: 'Passer d’un scénario écrit à une séquence vidéo',
                intro: 'Un récit continu demande plus qu’une longue consigne. Préparez une scène lisible, des références et un ordre de plans avant de produire les clips.',
                sections: [
                    {
                        id: 'scenario',
                        heading: 'Choisir une scène avec un changement visible',
                        paragraphs: [
                            'Prenez un extrait avec un lieu, peu de personnages et un événement précis. Remplacez les pensées intérieures par un geste ou une réplique courte. Saisissez le texte dans la création d’histoire, puis relisez la structure et le scénario de l’épisode.'
                        ],
                        checklist: ['Nommer les personnages sans variation.', 'Séparer les dialogues des actions.', 'Donner un objectif à chaque scène.']
                    },
                    {
                        id: 'plans',
                        heading: 'Répartir la révélation entre les plans',
                        paragraphs: [
                            'Un plan établit le lieu, le suivant révèle une information et le dernier montre la réaction. Cet exemple écrit permet de vérifier la progression avant de demander des images.'
                        ],
                        example:
                            'Plan large : Lina attend sous l’horloge d’une gare au crépuscule, manteau bleu et enveloppe rouge.\nGros plan : elle ouvre l’enveloppe et découvre un billet daté du lendemain.\nPlan moyen : elle regarde le quai vide et dit : « Il me reste donc du temps. »'
                    },
                    {
                        id: 'production',
                        heading: 'Valider les références avant les clips',
                        paragraphs: [
                            'Préparez les références du personnage et de la gare, puis vérifiez les images du storyboard ensemble. Choisissez un modèle et une durée adaptés à chaque plan. Contrôlez l’action, la voix et les transitions avant d’assembler l’épisode ; refaites seulement les éléments qui nécessitent une correction.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Peut-on adapter un roman en vidéo IA ?',
                        answer: 'Oui, en commençant par un extrait. Transformez la narration en actions visibles, relisez le scénario et préparez personnages et plans. Vérifiez l’adaptation scène par scène avant d’étendre le récit.'
                    },
                    {
                        question: 'Un scénario devient-il un film en une génération ?',
                        answer: 'Une génération vidéo reste limitée à la durée du modèle. Un récit plus long nécessite plusieurs clips, des références et un assemblage ; le scénario sert à organiser cette continuité.'
                    },
                    {
                        question: 'Quand vérifier les coûts ?',
                        answer: 'Avant chaque étape de génération. Texte, images et vidéos utilisent des crédits selon le modèle et l’usage. Les 1 000 crédits d’inscription ne garantissent pas un court métrage complet.'
                    }
                ]
            },
            'manga-storyboard': {
                title: 'Storyboard manga IA : du récit aux cases et aux plans',
                description:
                    'Découpez une intrigue en cases et plans lisibles, avec cadrage, action et dialogue, puis préparez les images d’une animation inspirée du manga. Suivez un exemple écrit en cinq cases.',
                keywords: ['storyboard manga IA', 'intrigue en storyboard', 'générateur de storyboard manga', 'plans de manga animé', 'tutoriel storyboard manga', 'composition des cases manga'],
                heading: 'Transformer une intrigue en storyboard manga lisible',
                intro: 'Le résumé raconte ce qui arrive ; le storyboard décide quand chaque information apparaît. Utilisez les cases comme unités de préparation pour votre court récit animé.',
                sections: [
                    {
                        id: 'beats',
                        heading: 'Une fonction narrative par case',
                        paragraphs: [
                            'Notez l’objectif du personnage, l’information nouvelle et sa réaction. Attribuez une seule fonction principale à chaque case avant d’écrire les consignes visuelles. Choisissez le style du projet, puis préparez les références des personnages et du décor.'
                        ]
                    },
                    {
                        id: 'example',
                        heading: 'Exemple écrit : une découverte sur un toit',
                        paragraphs: [
                            'La découverte est plus claire si l’objet est montré avant la réaction. Cette séquence sert à planifier les images ; elle ne constitue pas un export de planche imprimée.'
                        ],
                        example:
                            '1. Plan large : une coursière en veste jaune arrive sur un toit mouillé.\n2. Détail : une radio clignote près d’une flaque.\n3. Plan moyen : elle prend la radio.\n4. Gros plan : le porte-clés de son frère y est accroché.\n5. Réaction : elle se tourne vers l’escalier.',
                        checklist: ['Établir le lieu avant les détails.', 'Conserver la direction des regards.', 'Limiter les paroles à la durée du plan.']
                    },
                    {
                        id: 'continuity',
                        heading: 'Comparer les cases avant de les animer',
                        paragraphs: [
                            'Gardez la même veste, coiffure et palette. Vérifiez où se trouvent l’escalier et la radio dans chaque image. Corrigez une pose ou un accessoire incohérent avant la vidéo, puis choisissez mouvement et durée pour chaque plan.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Une intrigue suffit-elle pour préparer le storyboard ?',
                        answer: 'Elle fournit le point de départ. Décomposez-la ensuite en actions visibles, révélations et réactions, puis définissez cadrage, personnages et décor pour chaque plan.'
                    },
                    {
                        question: 'Est-ce un outil d’export de manga imprimé ?',
                        answer: 'Le flux décrit ici prépare des cases et des images de storyboard pour une production vidéo. Il ne promet pas de mise en page ou d’export d’un manga prêt à imprimer.'
                    },
                    {
                        question: 'Faut-il animer chaque case ?',
                        answer: 'Non. Une case aide à organiser l’information. Combinez ou séparez les plans selon l’action, puis respectez les durées et les références prises en charge par le modèle vidéo.'
                    }
                ]
            },
            'consistent-ai-characters': {
                title: 'Personnages IA cohérents : références et visages',
                description:
                    'Stabilisez les descriptions, références et détails visuels d’un personnage IA pour les images du storyboard et les clips d’un récit. Repérez les changements de visage entre les plans.',
                keywords: [
                    'personnage IA cohérent',
                    'cohérence personnage IA',
                    'même personnage plusieurs images',
                    'référence personnage IA',
                    'guide cohérence personnages IA',
                    'corriger les visages IA'
                ],
                heading: 'Garder un personnage reconnaissable d’un plan à l’autre',
                intro: 'La cohérence se prépare avant la vidéo. Une référence claire et des descriptions stables aident à comparer les résultats, sans garantir une identité parfaitement identique.',
                sections: [
                    {
                        id: 'reference',
                        heading: 'Choisir une référence facile à lire',
                        paragraphs: [
                            'Créez d’abord une image avec le visage, la coiffure et le costume bien visibles. Validez-la avant de produire les autres plans. Répétez les caractéristiques essentielles plutôt que de reformuler le personnage différemment à chaque demande.'
                        ],
                        checklist: ['Même nom et même costume.', 'Référence sans accessoires ambigus.', 'Lumière adaptée à la scène.']
                    },
                    {
                        id: 'example',
                        heading: 'Exemple écrit : des repères courts et stables',
                        paragraphs: ['Séparez les repères permanents de l’action du plan. Vous pourrez modifier la pose sans changer volontairement les caractéristiques de base.'],
                        example:
                            'Repères : Lina, cheveux noirs courts, manteau bleu, petite enveloppe rouge.\nPlan suivant : Lina debout près du banc de la gare, regard vers la voie, plan moyen, lumière du crépuscule. Utiliser la référence approuvée de Lina ; conserver coiffure, manteau et enveloppe.'
                    },
                    {
                        id: 'review',
                        heading: 'Contrôler toute la séquence',
                        paragraphs: [
                            'Comparez les visages, mains, vêtements et accessoires entre les images, puis pendant les clips. Une image de départ réussie ne garantit pas la fin du mouvement. Corrigez la dérive du plan concerné avant l’assemblage, avec un modèle acceptant les références nécessaires.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Une référence garantit-elle le même visage ?',
                        answer: 'Non. Elle guide le modèle, mais le visage, les vêtements et les accessoires peuvent changer. Il faut comparer les résultats et corriger les plans qui dérivent.'
                    },
                    {
                        question: 'Combien de détails faut-il répéter ?',
                        answer: 'Gardez les repères qui rendent le personnage reconnaissable : coiffure, costume, silhouette et accessoire important. Ajoutez séparément la pose, le cadrage et la lumière du plan.'
                    },
                    {
                        question: 'Pourquoi vérifier les images avant la vidéo ?',
                        answer: 'Une erreur de costume ou de visage peut se prolonger dans le clip. La vérification des références et des images du storyboard aide à limiter les reprises vidéo coûteuses.'
                    }
                ]
            },
            'image-to-video': {
                title: 'Guide image vers vidéo IA : préparer l’image et le mouvement',
                description:
                    'Choisissez une image lisible, écrivez une action simple et vérifiez la continuité pour créer un clip IA à partir d’une photo ou d’une illustration. Testez un exemple de mouvement et vérifiez la fin du plan.',
                keywords: ['guide image vers vidéo IA', 'animer une image avec IA', 'photo en vidéo IA', 'consigne image vers vidéo', 'tutoriel image vers vidéo', 'prompts de mouvement caméra'],
                heading: 'Préparer une image pour un mouvement lisible',
                intro: 'L’image fournit la composition ; la consigne précise le mouvement. Vérifiez la source et choisissez une action compatible avec le cadrage avant de générer le clip.',
                sections: [
                    {
                        id: 'source',
                        heading: 'Inspecter la source avant l’animation',
                        paragraphs: [
                            'Choisissez une image où le sujet, les mains et les objets importants sont nets. Vérifiez le recadrage et l’espace disponible pour l’action. Corrigez les défauts de l’image avant de les transporter dans un mouvement.'
                        ],
                        checklist: ['Visage et accessoires lisibles.', 'Place suffisante pour le geste.', 'Décor sans géométrie incohérente.']
                    },
                    {
                        id: 'motion',
                        heading: 'Exemple écrit : un mouvement principal',
                        paragraphs: ['Décrivez ce qui change et ce qui doit rester stable. Une petite action facilite le contrôle de l’identité et du décor sur toute la durée.'],
                        example:
                            'Utiliser l’image de la coursière comme référence visuelle. Elle tourne lentement la tête vers la porte du toit, puis reste immobile. Sa veste jaune bouge légèrement au vent. Caméra fixe, décor stable, lumière du crépuscule conservée, sans changement de scène.'
                    },
                    {
                        id: 'finish',
                        heading: 'Vérifier le début, le mouvement et la fin',
                        paragraphs: [
                            'Choisissez un modèle acceptant les images et une durée prise en charge. Les modes de référence et de première ou dernière image varient. Regardez le clip entier pour repérer un visage modifié, un accessoire flottant ou un mouvement de caméra imprévu avant de préparer le plan suivant.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'L’image devient-elle toujours la première image exacte ?',
                        answer: 'Non. Certaines options utilisent une image de départ, d’autres une référence générale. Vérifiez les capacités et le mode choisi avant de préparer une transition précise.'
                    },
                    {
                        question: 'Peut-on utiliser une photo ou une illustration ?',
                        answer: 'Oui, avec un modèle compatible et une source adaptée. Le mouvement doit rester plausible dans le cadrage, et les détails du résultat doivent être vérifiés.'
                    },
                    {
                        question: 'Comment produire une scène longue ?',
                        answer: 'Découpez-la en plusieurs actions et clips respectant les durées du modèle. Vérifiez les fins de plans et la continuité ; une seule image ne garantit pas un long récit stable.'
                    }
                ]
            },
            'ai-anime-video': {
                title: 'Vidéo anime IA : préparer un court récit animé',
                description:
                    'Planifiez le style, les personnages et les plans d’un court récit anime IA, puis contrôlez les images et le mouvement avant l’assemblage. Vérifiez style, images clés, son et montage.',
                keywords: ['vidéo anime IA', 'générateur anime IA', 'court récit animé IA', 'création animation IA', 'tutoriel vidéo anime IA', 'références personnages anime'],
                heading: 'Créer une séquence anime avec un style lisible',
                intro: 'Commencez par une courte scène, un personnage et un style défini. Préparer les images avant les clips aide à suivre l’histoire et à conserver une direction visuelle.',
                sections: [
                    {
                        id: 'style',
                        heading: 'Fixer le style et les repères du personnage',
                        paragraphs: [
                            'Définissez palette, traits et ombrage, puis préparez une référence du protagoniste et du décor. Vérifiez que les détails restent lisibles au format prévu. Un style anime ne dispense pas de contrôler visage, costume et accessoires.'
                        ]
                    },
                    {
                        id: 'sequence',
                        heading: 'Exemple écrit : une scène en trois plans',
                        paragraphs: ['Une action courte est plus facile à rythmer qu’un long résumé. Ce découpage prépare les images et la progression émotionnelle.'],
                        example:
                            'Plan large : une apprentie en uniforme vert entre dans un jardin au matin.\nDétail : un papillon lumineux se pose sur sa main.\nPlan moyen : elle relève doucement la tête vers un arbre, surprise. Caméra fixe, palette verte et dorée, ombrage doux.',
                        checklist: ['Un style commun pour tous les plans.', 'Une action principale par clip.', 'Une fin utilisable pour le raccord.']
                    },
                    {
                        id: 'animate',
                        heading: 'Animer et contrôler plan par plan',
                        paragraphs: [
                            'Générez les images du storyboard, comparez-les, puis choisissez les options vidéo compatibles avec les références et la durée. Inspectez les contours, les mains et les mouvements. Contrôlez voix et sous-titres si utilisés, puis assemblez les clips dans l’ordre du récit.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Une image anime suffit-elle pour un épisode ?',
                        answer: 'Elle peut fournir une référence ou un départ de plan. Un épisode nécessite plusieurs moments, des images adaptées et des vérifications de continuité entre les clips.'
                    },
                    {
                        question: 'Comment garder le même style ?',
                        answer: 'Réutilisez les repères de palette, de trait et d’ombrage, ainsi que les références approuvées. Comparez les plans ; les générations peuvent dériver malgré ces indications.'
                    },
                    {
                        question: 'Tous les modèles produisent-ils dialogue et son ?',
                        answer: 'Non. Les capacités audio varient selon le modèle et les options. Vérifiez-les avant d’écrire une scène qui dépend de paroles ou de sons synchronisés.'
                    }
                ]
            }
        },
        tools: {
            'ai-image-generator': {
                title: 'Générateur d’images IA pour personnages, décors et récits',
                description:
                    'Créez des images IA depuis un texte ou une référence pour préparer personnages, décors et visuels de récit avec makivue. Comparez modèles, formats et styles avant de générer.',
                keywords: ['générateur image IA', 'création image IA', 'personnage IA', 'décor IA', 'générateur concept art IA', 'images pour storyboard'],
                heading: 'Préparer les images qui donnent forme à votre histoire',
                intro: 'Choisissez un personnage, un décor ou un concept de couverture. Le texte explore une nouvelle idée ; une référence développe une direction déjà choisie.',
                actionLabel: 'Créer une image IA',
                features: [
                    { heading: 'Deux sources de création', text: 'Partez d’une description ou ajoutez une image compatible. Le modèle sélectionné détermine les références disponibles.' },
                    { heading: 'Des assets avec un rôle précis', text: 'Vérifiez le visage et le costume du personnage séparément de la géographie et de la lumière du décor.' },
                    {
                        heading: 'Une image prête pour la suite',
                        text: 'Choisissez le ratio adapté. Une couverture demande un espace pour le texte ; un plan animé demande de la place pour le mouvement.'
                    }
                ],
                steps: [
                    { heading: 'Définir le visuel', text: 'Décrivez un sujet, un lieu, le cadrage et le style. Évitez plusieurs images sans rapport dans une seule demande.' },
                    { heading: 'Choisir les réglages', text: 'Ouvrez l’espace image, sélectionnez modèle et ratio, puis vérifiez les options de référence et les tarifs.' },
                    { heading: 'Examiner le résultat', text: 'Contrôlez mains, visage et accessoires. Modifiez un problème précis, puis téléchargez l’image retenue pour la suite.' }
                ],
                useCases: [
                    { heading: 'Concepts de personnages', text: 'Explorez silhouette, costume et coiffure avant de produire plusieurs plans du même protagoniste.' },
                    { heading: 'Décors et couvertures', text: 'Préparez une ambiance et une composition lisibles ; ajoutez les titres définitifs dans un flux de conception adapté.' }
                ],
                example: {
                    heading: 'Exemple écrit : un personnage à vérifier',
                    prompt: 'Une coursière en imperméable jaune, cheveux noirs courts, petite sacoche en toile, debout à l’entrée d’un toit au crépuscule. Plan moyen large, visage lisible, lumière douce, palette bleue et jaune, illustration cinématographique, fond simple.',
                    note: 'Exemple de consigne écrit, pas un résultat généré. Vérifiez le personnage avant de demander une autre pose ou de l’animer.'
                },
                faqs: [
                    {
                        question: 'Texte ou image de référence : que choisir ?',
                        answer: 'Le texte convient pour explorer une idée. Une référence aide à développer un personnage, une composition ou un style existants, selon les capacités du modèle.'
                    },
                    {
                        question: 'Peut-on préparer les visuels d’une mini-série ?',
                        answer: 'Oui. Créez personnages et décors, puis vérifiez les images ensemble avant leur utilisation en storyboard ou vidéo. La cohérence reste à contrôler.'
                    },
                    {
                        question: 'L’essai est-il illimité ?',
                        answer: 'Non. Les nouveaux comptes reçoivent 1 000 crédits. Les générations consomment ce solde selon le modèle et l’usage réel ; consultez les tarifs.'
                    }
                ]
            },
            'text-to-image': {
                title: 'Texte vers image IA : transformer une description en visuel',
                description:
                    'Décrivez sujet, décor, cadrage et lumière pour générer une image IA depuis un texte et préparer vos concepts visuels. Choisissez composition, style et format de l’image.',
                keywords: ['texte vers image IA', 'image depuis texte', 'générateur texte image', 'consigne image IA', 'prompts personnages IA', 'prompts décors IA'],
                heading: 'Donner une forme visible à une description',
                intro: 'Sans référence, partez d’une consigne précise. Une image doit montrer une situation, pas toute une intrigue ; choisissez les détails que vous pourrez vérifier.',
                actionLabel: 'Générer une image depuis un texte',
                features: [
                    { heading: 'Des détails observables', text: 'Décrivez le sujet, la pose, le décor, le cadrage et la lumière. Remplacez les idées abstraites par des éléments visibles.' },
                    { heading: 'Une exploration avant les références', text: 'Comparez des concepts, choisissez une direction, puis gardez l’image et ses repères pour les générations suivantes.' },
                    { heading: 'Un ratio selon l’usage', text: 'Portrait, décor large et image verticale n’ont pas le même cadrage. Vérifiez le crop et le point focal.' }
                ],
                steps: [
                    { heading: 'Écrire une seule image', text: 'Commencez par un sujet et un lieu, puis ajoutez costume, accessoire, lumière et style sans instructions contradictoires.' },
                    { heading: 'Choisir modèle et format', text: 'Saisissez la description dans l’espace image et vérifiez ratio, options et coût avant de lancer.' },
                    { heading: 'Affiner un choix', text: 'Si le cadrage convient mais pas la lumière, changez seulement l’éclairage pour comparer utilement les résultats.' }
                ],
                useCases: [
                    { heading: 'Explorer un lieu du récit', text: 'Rendez la disposition d’un quai ou d’une pièce concrète avant de préparer les plans.' },
                    { heading: 'Préparer une image animable', text: 'Placez clairement le sujet et laissez l’espace nécessaire au geste envisagé pour la vidéo.' }
                ],
                example: {
                    heading: 'Exemple écrit : un décor lisible',
                    prompt: 'Un quai de gare vide à l’heure bleue, vieille horloge ronde au-dessus d’un banc en bois, sol humide reflétant les lampes chaudes. Plan large à hauteur du quai, banc à gauche, rails à droite, proportions naturelles, style cinématographique réaliste.',
                    note: 'Cette consigne écrite prépare le décor. Une action de personnage doit faire l’objet d’un autre plan.'
                },
                faqs: [
                    {
                        question: 'Faut-il une image de départ ?',
                        answer: 'Non pour une génération à partir du texte avec un modèle compatible. Décrivez une image, choisissez le format et vérifiez le résultat.'
                    },
                    {
                        question: 'Que mettre dans la consigne ?',
                        answer: 'Sujet, décor, pose, cadrage, lumière et style. Gardez les détails importants ; plusieurs lieux ou actions successives compliquent une image unique.'
                    },
                    {
                        question: 'Peut-on ensuite animer le résultat ?',
                        answer: 'Oui, en utilisant une image approuvée dans une tâche vidéo compatible. Décrivez le mouvement séparément et contrôlez le clip entier.'
                    }
                ]
            },
            'image-to-image': {
                title: 'Image vers image IA : créer avec une référence visuelle',
                description:
                    'Utilisez une image de référence et une consigne pour développer personnages, cadrages et ambiances, puis comparez les changements. Précisez les éléments à conserver et à modifier.',
                keywords: ['image vers image IA', 'générateur image depuis image', 'référence visuelle IA', 'variation image IA', 'variations images IA', 'prompts image de référence'],
                heading: 'Développer une image sans perdre votre direction visuelle',
                intro: 'Indiquez pourquoi la référence est utile : sujet, composition ou style. Séparez les détails à conserver de la modification souhaitée avant de générer.',
                actionLabel: 'Créer avec une image de référence',
                features: [
                    { heading: 'Un rôle défini pour la référence', text: 'Précisez si le modèle doit s’appuyer sur le costume, la géographie du décor ou la palette.' },
                    { heading: 'Des changements ciblés', text: 'Demandez une nouvelle pose ou lumière à la fois. Une référence ne verrouille pas chaque détail du résultat.' },
                    { heading: 'Une comparaison avant la vidéo', text: 'Contrôlez visage, objets et disposition avant de transmettre l’image à plusieurs plans ; une dérive se corrige plus tôt.' }
                ],
                steps: [
                    { heading: 'Choisir une source claire', text: 'Le sujet et les détails importants doivent être lisibles. Évitez les références trop chargées ou ambiguës.' },
                    { heading: 'Décrire les différences', text: 'Ajoutez l’image à un modèle compatible, notez les repères conservés et choisissez le nouveau cadrage.' },
                    { heading: 'Comparer et enregistrer', text: 'Inspectez le résultat avec la source. Téléchargez une variation validée ou corrigez un changement indésirable.' }
                ],
                useCases: [
                    { heading: 'Nouvelles vues d’un personnage', text: 'Explorez pose et cadrage avec une référence approuvée, puis vérifiez les caractéristiques essentielles.' },
                    { heading: 'Ambiances d’un même décor', text: 'Changez la lumière tout en contrôlant portes, fenêtres et accessoires utiles à la scène.' }
                ],
                example: {
                    heading: 'Exemple écrit : une variation de cadrage',
                    prompt: 'Utiliser la coursière de l’image de référence. Conserver cheveux noirs courts, imperméable jaune et sacoche en toile. Plan moyen près de la porte du toit, regard vers une radio, lumière douce du crépuscule, illustration cinématographique, décor simple.',
                    note: 'La conservation exacte du visage et des accessoires n’est pas garantie. Comparez cette nouvelle génération à la référence.'
                },
                faqs: [
                    {
                        question: 'Est-ce une modification exacte de l’original ?',
                        answer: 'Il s’agit d’une nouvelle génération guidée par une image et un texte. Elle peut changer des détails même demandés comme stables.'
                    },
                    {
                        question: 'Peut-on changer le style ?',
                        answer: 'Oui, avec une consigne et un modèle acceptant les références. Vérifiez aussi le sujet et la composition ; leur conservation parfaite n’est pas garantie.'
                    },
                    {
                        question: 'Quelle différence avec image vers vidéo ?',
                        answer: 'Image vers image crée une nouvelle image fixe. Image vers vidéo ajoute un mouvement. Corrigez d’abord le visuel si son design n’est pas prêt.'
                    }
                ]
            },
            'text-to-video': {
                title: 'Texte vers vidéo IA : générer un clip depuis une consigne',
                description:
                    'Décrivez une scène, l’action du sujet et la caméra pour créer un clip IA depuis un texte, avec modèle et durée adaptés. Préparez un mouvement et une caméra pour chaque plan.',
                keywords: ['texte vers vidéo IA', 'générateur vidéo depuis texte', 'consigne en vidéo', 'création clip IA', 'prompts mouvement vidéo IA', 'clips vidéo courts IA'],
                heading: 'Décrire une scène et son mouvement pour la vidéo IA',
                intro: 'Sans image de départ, écrivez l’apparence du lieu et ce qui change pendant le clip. Limitez l’action pour obtenir un résultat facile à examiner.',
                actionLabel: 'Générer une vidéo depuis un texte',
                features: [
                    { heading: 'Un mouvement lisible', text: 'Définissez un geste principal et une caméra claire. Une consigne vidéo doit préciser davantage qu’une description d’image.' },
                    { heading: 'Un modèle adapté au plan', text: 'Durée, audio, références et tarifs varient. Vérifiez les options avant de demander dialogue ou mouvement complexe.' },
                    {
                        heading: 'Plusieurs clips pour un récit',
                        text: 'Une génération respecte les limites du modèle. Utilisez scénario et storyboard pour organiser une scène ou un épisode plus long.'
                    }
                ],
                steps: [
                    { heading: 'Planifier le début et la fin', text: 'Choisissez lieu, sujet et action principale. Réservez les autres événements à des plans distincts.' },
                    { heading: 'Saisir la consigne', text: 'Ouvrez l’espace vidéo, choisissez modèle, ratio et durée disponibles, puis consultez le coût.' },
                    { heading: 'Regarder toute l’action', text: 'Vérifiez gestes, accessoires, caméra et fin de plan. Simplifiez la demande si l’action devient précipitée.' }
                ],
                useCases: [
                    { heading: 'Plans d’ambiance', text: 'Une rue vide ou un quai venteux peut établir le lieu avant l’apparition des personnages.' },
                    { heading: 'Essais de mouvement', text: 'Testez un geste simple avant une scène longue ; utilisez une référence si un design précis est important.' }
                ],
                example: {
                    heading: 'Exemple écrit : un seul objectif de mouvement',
                    prompt: 'Un quai vide au crépuscule, lampes chaudes sur le sol humide. Un billet de papier glisse lentement au premier plan sous une brise légère, puis s’arrête près du banc. Plan large, caméra fixe, style réaliste cinématographique, sans changement de lieu.',
                    note: 'Choisissez une durée compatible. Son et dialogue dépendent du modèle ; cet exemple écrit ne garantit pas le résultat.'
                },
                faqs: [
                    {
                        question: 'Faut-il fournir une image ?',
                        answer: 'Non pour une tâche textuelle avec un modèle compatible. Décrivez scène et mouvement, choisissez les réglages et contrôlez le clip.'
                    },
                    {
                        question: 'Une consigne peut-elle produire un film complet ?',
                        answer: 'Une demande produit un clip dans les limites du modèle. Un film demande généralement plusieurs plans, des références et un assemblage.'
                    },
                    {
                        question: 'La vidéo comprend-elle du son ?',
                        answer: 'Cela dépend du modèle et des options sélectionnées. Vérifiez les capacités avant une scène reposant sur des paroles ou des sons synchronisés.'
                    }
                ]
            },
            'image-to-video': {
                title: 'Image vers vidéo IA : animer une photo ou une illustration',
                description:
                    'Ajoutez une image, décrivez le mouvement et choisissez un modèle compatible pour produire un clip IA à partir d’un visuel fixe. Vérifiez personnages et arrière-plan sur tout le clip.',
                keywords: ['image vers vidéo IA', 'photo en vidéo IA', 'animer image IA', 'générateur vidéo depuis image', 'animation image fixe', 'vidéo depuis illustration IA'],
                heading: 'Donner un mouvement prévu à une image fixe',
                intro: 'Partez d’un visuel déjà vérifié. L’image fournit la direction visuelle ; la consigne précise l’action, le mouvement du décor et la caméra.',
                actionLabel: 'Créer une vidéo depuis une image',
                features: [
                    { heading: 'Une source inspectée', text: 'Vérifiez visage, mains, accessoires et crop. Les erreurs de l’image peuvent se prolonger dans le clip.' },
                    { heading: 'Un geste avec des repères stables', text: 'Indiquez ce qui bouge et ce qui reste en place. Évitez caméra fixe et orbite rapide dans la même consigne.' },
                    { heading: 'Des références selon le modèle', text: 'Première image, dernière image et référence générale ne sont pas équivalentes. Vérifiez le mode et la durée disponibles.' }
                ],
                steps: [
                    { heading: 'Préparer l’image', text: 'Choisissez une composition claire avec de l’espace pour le geste. Corrigez d’abord les défauts du visuel.' },
                    { heading: 'Ajouter image et mouvement', text: 'Utilisez un modèle acceptant la référence, décrivez une action principale et sélectionnez ratio et durée compatibles.' },
                    { heading: 'Contrôler la fin du clip', text: 'Vérifiez visage, objets et caméra sur toute la durée. Une bonne première image ne garantit pas un bon raccord final.' }
                ],
                useCases: [
                    { heading: 'Réactions de personnages', text: 'Animez un petit mouvement de tête ou une posture en surveillant le costume et le visage.' },
                    { heading: 'Décors en mouvement', text: 'Essayez pluie, rideaux ou léger déplacement de caméra, tout en vérifiant la géométrie du lieu.' }
                ],
                example: {
                    heading: 'Exemple écrit : animer sans changer de scène',
                    prompt: 'Utiliser l’image de la coursière comme référence. Elle tourne doucement la tête vers la porte puis s’immobilise. L’imperméable jaune bouge légèrement au vent. Caméra fixe, fond stable, lumière du crépuscule conservée, pas de changement de scène.',
                    note: 'Le mode de référence dépend du modèle. Regardez tout le résultat pour vérifier l’identité et les accessoires.'
                },
                faqs: [
                    {
                        question: 'Une photo et une illustration sont-elles utilisables ?',
                        answer: 'Oui avec un modèle compatible et une image lisible. Choisissez une action plausible et vérifiez les modifications du visage et du décor.'
                    },
                    {
                        question: 'La source est-elle la première image exacte ?',
                        answer: 'Pas toujours. Certains modes utilisent une image de départ, d’autres une référence générale. Vérifiez les options avant de planifier une transition précise.'
                    },
                    {
                        question: 'Peut-on générer une longue scène ?',
                        answer: 'Chaque demande suit les durées du modèle. Pour un récit long, préparez plusieurs plans, inspectez les fins et organisez la continuité dans un storyboard.'
                    }
                ]
            }
        }
    },
    id: {
        guideIndex: {
            title: 'Panduan video AI: naskah, storyboard, dan karakter',
            description:
                'Pelajari naskah ke video, storyboard manga, konsistensi karakter, gambar ke video, dan produksi anime melalui alur kerja makivue. Dilengkapi contoh tertulis dan checklist produksi.',
            heading: 'Siapkan cerita berikutnya, satu langkah yang jelas',
            intro: 'Pilih tahap yang sedang Anda kerjakan. Setiap panduan berisi langkah praktis, contoh tertulis, dan pemeriksaan sebelum memakai kredit untuk video.',
            label: 'Panduan kreasi AI',
            contents: 'Isi panduan',
            example: 'Contoh tertulis untuk disesuaikan',
            faq: 'Pertanyaan tentang alur ini',
            related: 'Lanjutkan produksi',
            feature: 'Lihat alat kreasi terkait',
            action: 'Mulai berkarya',
            pricing: 'Lihat harga model',
            walkthrough: 'Baca panduan studio lengkap',
            credits: 'Akun baru menerima 1.000 kredit pendaftaran. Generasi memakai kredit sesuai model dan penggunaan aktual; bonus ini tidak menjamin video atau serial lengkap.',
            updated: 'Diperbarui',
            byline: 'Tim editorial makivue'
        },
        toolIndex: {
            title: 'Alat gambar dan video AI: teks, referensi, dan gerak',
            description:
                'Bandingkan generator gambar AI, teks ke gambar, gambar ke gambar, teks ke video, dan gambar ke video untuk kebutuhan cerita Anda. Bandingkan input, pilihan model, dan kegunaannya.',
            heading: 'Pilih bahan awal untuk gambar atau video Anda',
            intro: 'Mulai dari deskripsi untuk mengeksplorasi ide, gambar referensi untuk mengembangkan visual, atau naskah untuk merancang beberapa shot. Pahami langkahnya sebelum membuka ruang kreasi.',
            label: 'Alat kreasi gambar dan video AI',
            features: 'Yang dapat disiapkan melalui alur ini',
            steps: 'Dari bahan awal ke hasil yang diperiksa',
            useCases: 'Kebutuhan praktis untuk memulai',
            example: 'Contoh prompt tertulis',
            faq: 'Pertanyaan sebelum generasi',
            related: 'Jelajahi alur terkait',
            action: 'Buka ruang kreasi',
            pricing: 'Bandingkan harga model',
            guide: 'Baca panduan praktis',
            videoTool: 'Lihat generator video AI',
            dramaTool: 'Rancang drama pendek AI lengkap',
            credits: 'Akun baru menerima 1.000 kredit pendaftaran. Generasi ditagih sesuai model dan penggunaan aktual; bonus tidak menjamin video atau serial lengkap.',
            compare: 'Bandingkan bahan awal'
        },
        guides: {
            'script-to-video': {
                title: 'Naskah ke video AI: merancang cerita pendek',
                description:
                    'Ubah naskah atau kutipan novel menjadi karakter, lokasi, storyboard, dan klip untuk cerita pendek dengan makivue. Ikuti contoh adegan tiga shot sebelum membuat satu episode.',
                keywords: ['naskah ke video AI', 'novel menjadi video', 'cerita ke video', 'film pendek AI', 'tutorial naskah ke video', 'adaptasi novel AI'],
                heading: 'Dari adegan tertulis ke rangkaian video',
                intro: 'Cerita yang berkesinambungan memerlukan susunan shot, bukan hanya satu prompt panjang. Siapkan adegan yang jelas dan referensi sebelum menghasilkan klip.',
                sections: [
                    {
                        id: 'script',
                        heading: 'Pilih adegan dengan perubahan yang terlihat',
                        paragraphs: [
                            'Gunakan satu lokasi, sedikit tokoh, dan titik perubahan yang jelas. Ubah pikiran batin menjadi tindakan atau dialog singkat. Masukkan ide atau naskah ke alur cerita, lalu periksa struktur dan naskah episode sebelum membuat gambar.'
                        ],
                        checklist: ['Gunakan nama tokoh yang tetap.', 'Pisahkan dialog dan deskripsi aksi.', 'Tentukan tujuan setiap adegan.']
                    },
                    {
                        id: 'shots',
                        heading: 'Contoh tertulis: pisahkan informasi dan reaksi',
                        paragraphs: ['Shot pertama menunjukkan tempat, berikutnya mengungkap informasi, dan terakhir memperlihatkan respons. Susunan ini membantu memeriksa alur sebelum generasi.'],
                        example:
                            'Shot lebar: Lina menunggu di bawah jam stasiun saat senja, memakai mantel biru dan membawa amplop merah.\nClose-up: ia membuka amplop dan menemukan tiket bertanggal besok.\nShot sedang: ia menatap peron kosong dan berkata, “Berarti masih ada waktu.”'
                    },
                    {
                        id: 'produce',
                        heading: 'Periksa referensi sebelum membuat klip',
                        paragraphs: [
                            'Siapkan gambar referensi tokoh dan stasiun, lalu bandingkan gambar storyboard. Pilih model dan durasi sesuai setiap shot. Periksa gerak, suara, dan sambungan sebelum menyusun episode; ulangi hanya bagian yang memang perlu diperbaiki.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Bisakah novel diadaptasi menjadi video AI?',
                        answer: 'Bisa, dimulai dari satu kutipan. Ubah narasi menjadi aksi yang terlihat, periksa adaptasi naskah, dan siapkan referensi serta shot sebelum memperluas cerita.'
                    },
                    {
                        question: 'Apakah satu generasi menghasilkan film lengkap?',
                        answer: 'Generasi video dibatasi durasi model. Cerita panjang biasanya perlu beberapa klip, perencanaan karakter dan shot, serta tahap penggabungan.'
                    },
                    {
                        question: 'Kapan biaya diperiksa?',
                        answer: 'Sebelum setiap tahap generasi. Teks, gambar, dan video memakai kredit sesuai model dan penggunaan. Bonus 1.000 kredit tidak menjamin film pendek selesai.'
                    }
                ]
            },
            'manga-storyboard': {
                title: 'Storyboard manga AI: dari plot ke panel dan shot',
                description: 'Pecah plot menjadi panel dengan aksi, komposisi, dan dialog yang jelas untuk menyiapkan cerita animasi bergaya manga. Ikuti contoh lima panel dan tinjau urutan adegan.',
                keywords: ['storyboard manga AI', 'plot menjadi storyboard', 'generator storyboard manga', 'panel manga AI', 'tutorial storyboard manga', 'komposisi panel manga'],
                heading: 'Susun plot menjadi storyboard manga yang mudah dibaca',
                intro: 'Plot menjelaskan kejadian; storyboard menentukan kapan penonton melihat informasi. Gunakan panel sebagai unit perencanaan untuk cerita animasi.',
                sections: [
                    {
                        id: 'beats',
                        heading: 'Satu fungsi cerita untuk setiap panel',
                        paragraphs: [
                            'Catat tujuan tokoh, informasi baru, dan reaksinya. Berikan satu tugas utama pada tiap panel sebelum menulis prompt gambar. Pilih gaya proyek, lalu siapkan referensi karakter dan lokasi.'
                        ]
                    },
                    {
                        id: 'example',
                        heading: 'Contoh tertulis: penemuan di atap',
                        paragraphs: ['Objek perlu dikenalkan sebelum reaksi agar penemuan terbaca. Urutan ini merencanakan gambar dan shot, bukan menjanjikan ekspor halaman manga siap cetak.'],
                        example:
                            '1. Shot lebar: kurir berjaket kuning tiba di atap basah.\n2. Detail: radio berkedip dekat genangan.\n3. Shot sedang: ia mengambil radio.\n4. Close-up: gantungan kunci kakaknya terlihat pada radio.\n5. Reaksi: ia menoleh ke tangga.',
                        checklist: ['Kenalkan lokasi sebelum detail.', 'Jaga arah pandangan dan posisi objek.', 'Sesuaikan dialog dengan durasi shot.']
                    },
                    {
                        id: 'review',
                        heading: 'Bandingkan panel sebelum diberi gerak',
                        paragraphs: [
                            'Pertahankan jaket, rambut, dan palet yang sama. Periksa posisi tangga dan radio di seluruh gambar. Perbaiki pose atau aksesori yang berubah sebelum video, lalu tentukan gerak dan durasi sesuai kemampuan model.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Apakah plot cukup untuk membuat storyboard?',
                        answer: 'Plot adalah bahan awal. Uraikan menjadi aksi, informasi baru, dan reaksi, lalu tentukan komposisi, karakter, dan tempat untuk setiap shot.'
                    },
                    {
                        question: 'Apakah alur ini mengekspor manga siap cetak?',
                        answer: 'Alur ini menyiapkan panel dan gambar storyboard untuk produksi video. Tidak ada janji tata letak atau ekspor manga cetak melalui panduan ini.'
                    },
                    {
                        question: 'Haruskah setiap panel menjadi satu klip?',
                        answer: 'Tidak. Panel membantu merancang informasi. Gabungkan atau pisahkan shot sesuai aksi, lalu ikuti durasi dan referensi yang didukung model video.'
                    }
                ]
            },
            'consistent-ai-characters': {
                title: 'Karakter AI konsisten: referensi dari gambar ke shot',
                description: 'Siapkan gambar referensi dan deskripsi karakter yang tetap untuk memeriksa konsistensi gambar storyboard dan klip video. Periksa perubahan wajah dan kostum antarscene.',
                keywords: ['karakter AI konsisten', 'konsistensi karakter AI', 'tokoh sama beberapa gambar', 'referensi karakter AI', 'panduan konsistensi karakter AI', 'atasi wajah AI berubah'],
                heading: 'Menjaga karakter tetap dikenali antar-shot',
                intro: 'Konsistensi dimulai sebelum video. Referensi yang jelas dan deskripsi yang stabil membantu menilai hasil, tetapi tidak menjamin identitas yang persis sama.',
                sections: [
                    {
                        id: 'reference',
                        heading: 'Pilih referensi yang mudah diperiksa',
                        paragraphs: [
                            'Buat satu gambar dengan wajah, rambut, dan pakaian yang terlihat jelas. Setujui desain itu sebelum menghasilkan shot lain. Ulangi ciri penting, alih-alih menulis karakter dengan deskripsi berbeda pada setiap permintaan.'
                        ],
                        checklist: ['Nama dan pakaian tetap.', 'Aksesori penting tidak ambigu.', 'Cahaya sesuai lokasi cerita.']
                    },
                    {
                        id: 'example',
                        heading: 'Contoh tertulis: pisahkan ciri dan aksi',
                        paragraphs: ['Ciri tetap menjadi jangkar desain; pose dan komposisi mengikuti kebutuhan shot. Dengan pemisahan ini, perubahan aksi tidak perlu mengubah deskripsi identitas.'],
                        example:
                            'Ciri tetap: Lina, rambut hitam pendek, mantel biru, amplop merah kecil.\nShot baru: Lina berdiri di dekat bangku stasiun, melihat ke arah rel, shot sedang, cahaya senja. Gunakan referensi Lina yang disetujui; pertahankan rambut, mantel, dan amplop.'
                    },
                    {
                        id: 'sequence',
                        heading: 'Periksa seluruh urutan',
                        paragraphs: [
                            'Bandingkan wajah, tangan, pakaian, dan aksesori antar-gambar, lalu sepanjang klip. Awal video yang baik tidak menjamin akhir gerak. Koreksi shot yang melenceng sebelum penggabungan dan gunakan model yang mendukung referensi yang diperlukan.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Apakah referensi menjamin wajah selalu sama?',
                        answer: 'Tidak. Referensi mengarahkan model, tetapi wajah, pakaian, dan aksesori dapat berubah. Bandingkan hasil dan perbaiki shot yang menyimpang.'
                    },
                    {
                        question: 'Ciri apa yang sebaiknya diulang?',
                        answer: 'Ulangi rambut, pakaian, siluet, dan aksesori penting yang membuat tokoh dikenali. Tulis pose, komposisi, dan cahaya secara terpisah untuk tiap shot.'
                    },
                    {
                        question: 'Mengapa gambar diperiksa sebelum video?',
                        answer: 'Kesalahan wajah atau pakaian bisa terbawa ke klip. Memeriksa referensi dan gambar storyboard lebih awal membantu mengurangi pengulangan video yang mahal.'
                    }
                ]
            },
            'image-to-video': {
                title: 'Panduan gambar ke video AI: sumber, gerak, dan akhir shot',
                description:
                    'Pilih gambar yang jelas, tulis gerak sederhana, dan periksa kontinuitas untuk membuat video AI dari foto atau ilustrasi. Coba contoh gerak dan periksa bagian akhir setiap shot.',
                keywords: ['panduan gambar ke video AI', 'animasi gambar AI', 'foto menjadi video AI', 'prompt gambar ke video', 'tutorial gambar ke video', 'prompt gerak kamera AI'],
                heading: 'Siapkan gambar untuk gerak yang mudah dinilai',
                intro: 'Gambar menyediakan komposisi, sedangkan prompt menjelaskan gerak. Periksa sumber dan pilih aksi yang masuk akal dalam bingkai sebelum menghasilkan klip.',
                sections: [
                    {
                        id: 'source',
                        heading: 'Periksa gambar sebelum animasi',
                        paragraphs: [
                            'Pilih sumber dengan subjek, tangan, dan benda penting yang jelas. Periksa pemotongan serta ruang untuk bergerak. Perbaiki cacat gambar sebelum meminta model membawanya ke dalam gerak.'
                        ],
                        checklist: ['Wajah dan aksesori terbaca.', 'Ada ruang untuk tindakan.', 'Bentuk latar masuk akal.']
                    },
                    {
                        id: 'motion',
                        heading: 'Contoh tertulis: satu gerakan utama',
                        paragraphs: ['Jelaskan bagian yang berubah dan bagian yang perlu stabil. Gerak kecil memudahkan pemeriksaan karakter dan lokasi sepanjang durasi.'],
                        example:
                            'Gunakan gambar kurir sebagai referensi visual. Ia perlahan menoleh ke pintu atap lalu diam. Jaket kuning bergerak sedikit tertiup angin. Kamera tetap, latar stabil, cahaya senja dipertahankan, tanpa perpindahan lokasi.'
                    },
                    {
                        id: 'ending',
                        heading: 'Periksa awal, proses, dan akhir',
                        paragraphs: [
                            'Pilih model yang menerima gambar dan durasi yang tersedia. Mode referensi, bingkai awal, dan bingkai akhir berbeda antar-model. Tonton seluruh klip untuk menemukan perubahan wajah, benda melayang, atau gerak kamera tak diinginkan sebelum merancang shot berikutnya.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Apakah gambar selalu menjadi bingkai pertama persis?',
                        answer: 'Tidak. Sebagian mode memakai bingkai awal, sebagian memakai referensi umum. Periksa kemampuan model dan mode yang dipilih untuk transisi yang presisi.'
                    },
                    {
                        question: 'Bisakah memakai foto atau ilustrasi?',
                        answer: 'Bisa dengan model yang sesuai dan sumber yang jelas. Pilih gerak yang cocok dengan komposisi, lalu periksa perubahan pada hasil.'
                    },
                    {
                        question: 'Bagaimana membuat adegan panjang?',
                        answer: 'Pecah menjadi aksi dan klip yang mengikuti durasi model. Periksa akhir shot serta kontinuitas; satu gambar tidak menjamin cerita panjang tetap stabil.'
                    }
                ]
            },
            'ai-anime-video': {
                title: 'Video anime AI: merancang cerita animasi pendek',
                description:
                    'Tentukan gaya, karakter, storyboard, dan gerak untuk cerita anime AI, lalu periksa setiap klip sebelum penggabungan. Tinjau gaya, keyframe, suara, dan penyuntingan episode.',
                keywords: ['video anime AI', 'generator anime AI', 'cerita animasi AI', 'membuat anime AI', 'tutorial video anime AI', 'referensi karakter anime'],
                heading: 'Buat urutan anime dengan arah visual yang jelas',
                intro: 'Mulai dari adegan pendek, satu tokoh, dan gaya yang ditentukan. Menyiapkan gambar lebih dulu membantu menjaga alur dan arah visual sebelum animasi.',
                sections: [
                    {
                        id: 'style',
                        heading: 'Tentukan gaya dan ciri karakter',
                        paragraphs: [
                            'Tetapkan palet, garis, dan bayangan, lalu buat referensi tokoh serta lokasi. Periksa apakah detail tetap jelas pada format yang dipilih. Gaya anime tetap memerlukan pemeriksaan wajah, pakaian, dan aksesori.'
                        ]
                    },
                    {
                        id: 'example',
                        heading: 'Contoh tertulis: cerita dalam tiga shot',
                        paragraphs: ['Tindakan singkat lebih mudah diatur ritmenya daripada ringkasan panjang. Susunan ini membantu menyiapkan gambar dan perubahan emosi.'],
                        example:
                            'Shot lebar: seorang murid berseragam hijau memasuki taman pagi hari.\nDetail: kupu-kupu bercahaya hinggap di tangannya.\nShot sedang: ia perlahan mengangkat kepala ke arah pohon dengan ekspresi heran. Kamera tetap, palet hijau dan emas, bayangan lembut.',
                        checklist: ['Gaya yang sama antar-shot.', 'Satu aksi utama tiap klip.', 'Akhir yang bisa disambungkan.']
                    },
                    {
                        id: 'produce',
                        heading: 'Animasi dan pemeriksaan per shot',
                        paragraphs: [
                            'Hasilkan gambar storyboard dan bandingkan sebelum memilih opsi video yang sesuai dengan referensi dan durasi. Periksa garis, tangan, serta gerak. Jika memakai suara atau takarir, cek waktunya, lalu susun klip mengikuti cerita.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Apakah satu gambar anime cukup untuk episode?',
                        answer: 'Gambar dapat menjadi referensi atau awal shot. Episode memerlukan beberapa momen, gambar yang sesuai, dan pemeriksaan kontinuitas antar-klip.'
                    },
                    {
                        question: 'Bagaimana mempertahankan gaya anime?',
                        answer: 'Gunakan palet, garis, bayangan, dan referensi yang disetujui secara konsisten. Bandingkan hasil karena generasi masih dapat menyimpang.'
                    },
                    {
                        question: 'Apakah semua model mendukung dialog dan suara?',
                        answer: 'Tidak. Dukungan audio berbeda menurut model dan pengaturan. Periksa sebelum membuat adegan yang bergantung pada dialog atau bunyi sinkron.'
                    }
                ]
            }
        },
        tools: {
            'ai-image-generator': {
                title: 'Generator gambar AI untuk karakter, lokasi, dan cerita',
                description: 'Buat gambar AI dari teks atau referensi untuk menyiapkan karakter, lokasi, dan visual cerita melalui makivue. Bandingkan model, rasio gambar, dan gaya sebelum membuat.',
                keywords: ['generator gambar AI', 'gambar AI', 'karakter AI', 'lokasi cerita AI', 'generator concept art AI', 'gambar storyboard AI'],
                heading: 'Siapkan gambar yang membentuk cerita Anda',
                intro: 'Pilih karakter, lokasi, atau konsep sampul. Teks mengeksplorasi ide baru; referensi gambar membantu melanjutkan arah visual yang sudah dipilih.',
                actionLabel: 'Buat gambar AI',
                features: [
                    { heading: 'Dua bahan awal', text: 'Gunakan deskripsi atau tambahkan referensi yang kompatibel. Model menentukan opsi referensi yang tersedia.' },
                    { heading: 'Setiap aset punya tujuan', text: 'Periksa wajah dan pakaian tokoh terpisah dari susunan serta cahaya lokasi.' },
                    { heading: 'Siap untuk tahap berikutnya', text: 'Pilih rasio sesuai kebutuhan. Sampul membutuhkan ruang tulisan, sedangkan gambar animasi memerlukan ruang gerak.' }
                ],
                steps: [
                    { heading: 'Tentukan visual', text: 'Tulis satu subjek, tempat, komposisi, dan gaya. Hindari meminta beberapa gambar tak terkait sekaligus.' },
                    { heading: 'Pilih pengaturan', text: 'Buka ruang gambar, pilih model dan rasio, lalu periksa dukungan referensi serta biaya.' },
                    { heading: 'Nilai hasil', text: 'Periksa tangan, wajah, dan benda penting. Koreksi satu masalah, lalu unduh gambar yang dipilih.' }
                ],
                useCases: [
                    { heading: 'Konsep karakter', text: 'Eksplorasi bentuk tubuh, pakaian, dan rambut sebelum membuat banyak shot protagonis.' },
                    { heading: 'Lokasi dan sampul', text: 'Siapkan suasana dan komposisi jelas; tambahkan judul akhir melalui proses desain yang sesuai.' }
                ],
                example: {
                    heading: 'Contoh tertulis: karakter yang bisa diperiksa',
                    prompt: 'Kurir muda memakai jas hujan kuning, rambut hitam pendek, tas kanvas kecil, berdiri di pintu atap saat senja. Shot sedang lebar, wajah jelas, cahaya lembut, palet biru dan kuning, ilustrasi sinematik, latar sederhana.',
                    note: 'Ini contoh prompt tertulis, bukan hasil generasi. Periksa karakter sebelum mencoba pose lain atau animasi.'
                },
                faqs: [
                    {
                        question: 'Kapan memakai teks atau referensi?',
                        answer: 'Teks membantu mencari ide. Referensi membantu mengembangkan karakter, komposisi, atau gaya yang ada, sesuai kemampuan model.'
                    },
                    {
                        question: 'Bisakah membuat bahan drama pendek?',
                        answer: 'Bisa. Siapkan tokoh dan lokasi, lalu bandingkan sebelum dipakai dalam storyboard atau video. Konsistensi tetap perlu diperiksa.'
                    },
                    {
                        question: 'Apakah uji coba tanpa batas?',
                        answer: 'Tidak. Akun baru menerima 1.000 kredit. Generasi memakai saldo sesuai model dan penggunaan aktual; lihat biaya sebelum mulai.'
                    }
                ]
            },
            'text-to-image': {
                title: 'Teks ke gambar AI: ubah deskripsi menjadi visual',
                description: 'Tuliskan subjek, lokasi, komposisi, dan cahaya untuk menghasilkan gambar AI dari teks dan mengembangkan konsep cerita. Pilih komposisi, cahaya, gaya, dan rasio gambar.',
                keywords: ['teks ke gambar AI', 'gambar dari teks', 'generator teks gambar', 'prompt gambar AI', 'prompt konsep karakter', 'prompt gambar latar AI'],
                heading: 'Berikan bentuk visual pada deskripsi',
                intro: 'Tanpa referensi, mulailah dengan prompt yang konkret. Satu gambar menunjukkan satu keadaan, bukan seluruh plot; pilih detail yang dapat Anda periksa.',
                actionLabel: 'Buat gambar dari teks',
                features: [
                    { heading: 'Detail yang terlihat', text: 'Jelaskan subjek, pose, tempat, komposisi, dan cahaya. Ubah gagasan abstrak menjadi unsur yang tampak.' },
                    { heading: 'Eksplorasi sebelum referensi', text: 'Bandingkan konsep, pilih arah, lalu simpan gambar dan cirinya untuk generasi berikutnya.' },
                    { heading: 'Rasio sesuai penggunaan', text: 'Potret, lokasi lebar, dan gambar vertikal memerlukan komposisi berbeda. Periksa potongan dan fokus utama.' }
                ],
                steps: [
                    { heading: 'Tulis satu gambar', text: 'Mulai dari subjek dan lokasi, lalu tambah pakaian, benda, cahaya, dan gaya tanpa instruksi bertentangan.' },
                    { heading: 'Pilih model dan format', text: 'Masukkan deskripsi ke ruang gambar dan periksa rasio, opsi, serta biaya sebelum generasi.' },
                    { heading: 'Perbaiki satu keputusan', text: 'Jika komposisi cocok tetapi cahaya keliru, ubah cahaya saja agar perbandingan berikutnya berguna.' }
                ],
                useCases: [
                    { heading: 'Menggambarkan lokasi cerita', text: 'Buat susunan peron atau ruangan jelas sebelum merancang shot dan posisi karakter.' },
                    { heading: 'Menyiapkan gambar untuk animasi', text: 'Tempatkan subjek dengan jelas dan sisakan ruang untuk tindakan yang direncanakan.' }
                ],
                example: {
                    heading: 'Contoh tertulis: lokasi yang terbaca',
                    prompt: 'Peron kosong saat langit membiru, jam bulat tua di atas bangku kayu, lantai basah memantulkan lampu hangat. Shot lebar setinggi peron, bangku di kiri dan rel di kanan, proporsi alami, gaya sinematik realistis.',
                    note: 'Prompt tertulis ini menyiapkan lokasi. Tindakan tokoh perlu dirancang sebagai shot tersendiri.'
                },
                faqs: [
                    { question: 'Apakah perlu gambar awal?', answer: 'Tidak untuk generasi teks dengan model yang sesuai. Tulis deskripsi, pilih format, lalu periksa hasilnya.' },
                    {
                        question: 'Apa isi prompt yang berguna?',
                        answer: 'Subjek, lokasi, pose, komposisi, cahaya, dan gaya. Utamakan detail penting; banyak lokasi dan aksi berturut-turut menyulitkan satu gambar.'
                    },
                    {
                        question: 'Bisakah hasilnya dijadikan video?',
                        answer: 'Bisa, dengan gambar yang disetujui dan tugas video yang kompatibel. Tulis gerak secara terpisah dan periksa seluruh klip.'
                    }
                ]
            },
            'image-to-image': {
                title: 'Gambar ke gambar AI: berkreasi dengan referensi visual',
                description:
                    'Gunakan referensi gambar dan prompt untuk mengembangkan karakter, komposisi, dan suasana, lalu bandingkan perubahan hasil. Jelaskan bagian yang dipertahankan dan yang diubah.',
                keywords: ['gambar ke gambar AI', 'generator gambar dari gambar', 'referensi gambar AI', 'variasi gambar AI', 'edit gambar dengan referensi', 'prompt gambar referensi'],
                heading: 'Kembangkan gambar dengan arah visual yang terjaga',
                intro: 'Tentukan fungsi referensi: subjek, komposisi, atau gaya. Pisahkan ciri yang ingin dipertahankan dari perubahan yang diminta sebelum generasi.',
                actionLabel: 'Buat dengan gambar referensi',
                features: [
                    { heading: 'Fungsi referensi yang jelas', text: 'Jelaskan apakah model perlu mengikuti pakaian, susunan tempat, atau palet gambar awal.' },
                    { heading: 'Perubahan terarah', text: 'Minta satu pose atau cahaya baru setiap kali. Referensi tidak mengunci semua detail hasil.' },
                    { heading: 'Pemeriksaan sebelum video', text: 'Periksa wajah, benda, dan posisi sebelum gambar masuk ke beberapa shot agar penyimpangan ditemukan lebih awal.' }
                ],
                steps: [
                    { heading: 'Pilih sumber jelas', text: 'Subjek dan ciri penting harus terbaca. Hindari gambar yang terlalu ramai atau ambigu.' },
                    { heading: 'Tulis perbedaannya', text: 'Unggah ke model yang menerima referensi, tulis ciri tetap, dan pilih komposisi baru.' },
                    { heading: 'Bandingkan dan simpan', text: 'Periksa hasil bersama sumber. Unduh variasi yang disetujui atau koreksi perubahan yang tidak diinginkan.' }
                ],
                useCases: [
                    { heading: 'Sudut lain dari karakter', text: 'Coba pose dan komposisi dengan referensi yang disetujui, lalu periksa ciri pengenal tokoh.' },
                    { heading: 'Suasana lokasi yang sama', text: 'Ubah pencahayaan sambil memeriksa pintu, jendela, dan benda penting bagi adegan.' }
                ],
                example: {
                    heading: 'Contoh tertulis: perubahan komposisi',
                    prompt: 'Gunakan kurir pada gambar referensi. Pertahankan rambut hitam pendek, jas hujan kuning, dan tas kanvas. Shot sedang di dekat pintu atap, melihat radio, cahaya senja lembut, ilustrasi sinematik, latar sederhana.',
                    note: 'Wajah dan aksesori persis tidak dijamin. Bandingkan generasi baru dengan referensi.'
                },
                faqs: [
                    { question: 'Apakah ini edit persis gambar asli?', answer: 'Ini generasi baru yang diarahkan gambar dan teks. Hasil dapat mengubah detail meskipun diminta tetap sama.' },
                    { question: 'Bisakah mengganti gaya?', answer: 'Bisa dengan prompt dan model yang mendukung referensi. Periksa subjek dan komposisi juga; keduanya tidak dijamin tetap persis.' },
                    {
                        question: 'Apa bedanya dengan gambar ke video?',
                        answer: 'Gambar ke gambar menghasilkan gambar diam baru. Gambar ke video menambahkan gerak. Perbaiki desain visual lebih dulu jika belum siap.'
                    }
                ]
            },
            'text-to-video': {
                title: 'Teks ke video AI: buat klip dari prompt tertulis',
                description:
                    'Deskripsikan adegan, gerak subjek, dan kamera untuk menghasilkan klip AI dari teks dengan model serta durasi yang sesuai. Rencanakan satu gerak utama dan arah kamera per shot.',
                keywords: ['teks ke video AI', 'generator video dari teks', 'prompt menjadi video', 'klip video AI', 'prompt gerakan video AI', 'klip video pendek AI'],
                heading: 'Tulis adegan dan geraknya untuk video AI',
                intro: 'Tanpa gambar awal, jelaskan tampilan lokasi dan perubahan selama klip. Batasi tindakan agar hasil mudah diperiksa dan diperbaiki.',
                actionLabel: 'Buat video dari teks',
                features: [
                    { heading: 'Gerak yang terbaca', text: 'Tentukan satu aksi utama dan arah kamera yang jelas. Prompt video perlu menjelaskan gerak, bukan tampilan saja.' },
                    { heading: 'Model sesuai shot', text: 'Durasi, audio, referensi, dan tarif berbeda. Periksa opsi sebelum meminta dialog atau gerak kompleks.' },
                    { heading: 'Beberapa klip untuk cerita', text: 'Setiap generasi mengikuti batas model. Gunakan naskah dan storyboard untuk merancang adegan atau episode panjang.' }
                ],
                steps: [
                    { heading: 'Rencanakan awal dan akhir', text: 'Pilih lokasi, subjek, dan aksi utama. Pindahkan kejadian tambahan ke shot terpisah.' },
                    { heading: 'Masukkan prompt', text: 'Buka ruang video, pilih model, rasio, serta durasi yang tersedia, kemudian periksa biaya.' },
                    { heading: 'Tonton seluruh aksi', text: 'Periksa gerak, benda, kamera, dan akhir shot. Sederhanakan permintaan jika aksi terasa terburu-buru.' }
                ],
                useCases: [
                    { heading: 'Shot suasana', text: 'Jalan kosong atau peron berangin dapat memperkenalkan lokasi sebelum karakter muncul.' },
                    { heading: 'Uji gerak', text: 'Coba tindakan sederhana sebelum adegan panjang; gunakan referensi jika desain tertentu penting.' }
                ],
                example: {
                    heading: 'Contoh tertulis: satu tujuan gerak',
                    prompt: 'Peron kosong saat senja, lampu hangat memantul di lantai basah. Tiket kertas meluncur perlahan di depan terbawa angin ringan, lalu berhenti dekat bangku. Shot lebar, kamera tetap, gaya sinematik realistis, tanpa berpindah lokasi.',
                    note: 'Pilih durasi yang didukung. Suara dan dialog bergantung pada model; contoh tertulis ini bukan jaminan hasil.'
                },
                faqs: [
                    { question: 'Apakah harus mengunggah gambar?', answer: 'Tidak untuk tugas teks dengan model yang sesuai. Deskripsikan adegan dan gerak, pilih pengaturan, lalu periksa klip.' },
                    {
                        question: 'Bisakah satu prompt membuat film lengkap?',
                        answer: 'Satu permintaan membuat klip dalam batas model. Film biasanya memerlukan beberapa shot, referensi, dan penggabungan.'
                    },
                    { question: 'Apakah video mempunyai suara?', answer: 'Bergantung pada model dan opsi. Periksa kemampuan sebelum merancang adegan dengan dialog atau bunyi sinkron.' }
                ]
            },
            'image-to-video': {
                title: 'Gambar ke video AI: animasikan foto atau ilustrasi',
                description: 'Tambahkan gambar, deskripsikan gerak, dan pilih model yang kompatibel untuk menghasilkan klip AI dari visual diam. Periksa karakter dan latar pada seluruh durasi klip.',
                keywords: ['gambar ke video AI', 'foto menjadi video AI', 'animasi gambar AI', 'generator video dari gambar', 'animasi gambar diam', 'video dari ilustrasi AI'],
                heading: 'Berikan gerak terencana pada gambar diam',
                intro: 'Mulailah dari visual yang sudah diperiksa. Gambar menyediakan arah visual, sementara prompt menjelaskan tindakan, gerak latar, dan kamera.',
                actionLabel: 'Buat video dari gambar',
                features: [
                    { heading: 'Sumber yang diperiksa', text: 'Periksa wajah, tangan, aksesori, dan potongan. Kesalahan pada gambar bisa terbawa ke klip.' },
                    { heading: 'Aksi dengan jangkar stabil', text: 'Jelaskan apa yang bergerak dan apa yang diam. Hindari instruksi kamera tetap sekaligus mengorbit cepat.' },
                    { heading: 'Referensi sesuai model', text: 'Bingkai awal, bingkai akhir, dan referensi umum berbeda. Periksa mode serta durasi yang tersedia.' }
                ],
                steps: [
                    { heading: 'Siapkan gambar', text: 'Pilih komposisi yang jelas dengan ruang untuk aksi. Perbaiki cacat visual sebelum animasi.' },
                    { heading: 'Tambahkan gambar dan gerak', text: 'Pilih model yang menerima referensi, tulis satu tindakan utama, lalu tentukan rasio dan durasi kompatibel.' },
                    { heading: 'Periksa akhir klip', text: 'Pantau wajah, benda, dan kamera sepanjang durasi. Awal yang baik tidak menjamin akhir yang bisa disambung.' }
                ],
                useCases: [
                    { heading: 'Reaksi karakter', text: 'Animasikan gerakan kepala atau pose kecil sambil memeriksa wajah dan kostum.' },
                    { heading: 'Lokasi yang bergerak', text: 'Coba hujan, tirai, atau kamera perlahan sambil menilai bentuk dan tata ruang lokasi.' }
                ],
                example: {
                    heading: 'Contoh tertulis: animasi tanpa pindah adegan',
                    prompt: 'Gunakan gambar kurir sebagai referensi. Ia perlahan menoleh ke pintu lalu diam. Jas hujan kuning bergerak ringan tertiup angin. Kamera tetap, latar stabil, cahaya senja dipertahankan, tidak berganti adegan.',
                    note: 'Mode referensi bergantung pada model. Tonton seluruh hasil untuk menilai karakter dan aksesori.'
                },
                faqs: [
                    { question: 'Bisakah memakai foto atau ilustrasi?', answer: 'Bisa dengan model yang sesuai dan sumber yang jelas. Pilih aksi masuk akal lalu periksa perubahan wajah dan lokasi.' },
                    {
                        question: 'Apakah sumber menjadi bingkai pertama persis?',
                        answer: 'Tidak selalu. Ada mode bingkai awal dan referensi umum. Periksa opsi sebelum merancang transisi yang presisi.'
                    },
                    {
                        question: 'Bisakah membuat adegan panjang?',
                        answer: 'Setiap permintaan mengikuti durasi model. Cerita panjang perlu beberapa shot, pemeriksaan akhir, dan perencanaan kontinuitas dalam storyboard.'
                    }
                ]
            }
        }
    },
    fil: {
        guideIndex: {
            title: 'Mga gabay sa AI video: script, storyboard, at mga tauhan',
            description:
                'Alamin ang script tungo sa video, manga storyboard, pare-parehong tauhan, larawan tungo sa video, at paggawa ng anime sa makivue. May mga nakasulat na halimbawa at production checklist.',
            heading: 'Ihanda ang susunod na kuwento, isang malinaw na hakbang bawat pagkakataon',
            intro: 'Piliin ang bahagi ng paggawa na kailangan mo. May praktikal na proseso, nakasulat na halimbawa, at mga pagsusuri bago gumamit ng credit para sa video.',
            label: 'Mga gabay sa paglikha gamit ang AI',
            contents: 'Nilalaman ng gabay',
            example: 'Nakasulat na halimbawang maaaring baguhin',
            faq: 'Mga tanong tungkol sa prosesong ito',
            related: 'Ipagpatuloy ang paggawa',
            feature: 'Tingnan ang kaugnay na kagamitan',
            action: 'Magsimulang lumikha',
            pricing: 'Tingnan ang presyo ng mga modelo',
            walkthrough: 'Basahin ang buong gabay sa studio',
            credits:
                'May 1,000 credit sa pagpaparehistro ang bagong account. Gumagamit ng credit ang pagbuo ayon sa modelo at aktuwal na paggamit; hindi ginagarantiya ng bonus ang isang buong video o serye.',
            updated: 'Na-update noong',
            byline: 'Pangkat ng patnugot ng makivue'
        },
        toolIndex: {
            title: 'AI larawan at video: teksto, reference at galaw',
            description:
                'Ihambing ang AI image generator, teksto tungo sa larawan, larawan tungo sa larawan, teksto tungo sa video, at larawan tungo sa video. Ihambing ang input, modelo at praktikal na gamit.',
            heading: 'Piliin ang panimulang materyal ng iyong larawan o video',
            intro: 'Magsimula sa paglalarawan para sa bagong ideya, larawang sanggunian para sa umiiral na disenyo, o script para sa maraming kuha. Unawain ang proseso bago buksan ang lugar ng paglikha.',
            label: 'Mga kagamitan sa paglikha ng AI larawan at video',
            features: 'Maaaring ihanda sa prosesong ito',
            steps: 'Mula sa materyal hanggang sa resultang susuriin',
            useCases: 'Mga praktikal na gamit para magsimula',
            example: 'Halimbawa ng nakasulat na prompt',
            faq: 'Mga tanong bago bumuo',
            related: 'Tuklasin ang kaugnay na proseso',
            action: 'Buksan ang lugar ng paglikha',
            pricing: 'Ihambing ang presyo ng modelo',
            guide: 'Basahin ang praktikal na gabay',
            videoTool: 'Tingnan ang AI video generator',
            dramaTool: 'Magplano ng buong AI maikling drama',
            credits: 'May 1,000 credit sa pagpaparehistro ang bagong account. Ang singil ay ayon sa modelo at aktuwal na paggamit; hindi ginagarantiya ng bonus ang buong video o serye.',
            compare: 'Ihambing ang mga panimulang materyal'
        },
        guides: {
            'script-to-video': {
                title: 'Script tungo sa AI video: magplano ng maikling kuwento',
                description:
                    'Gawing mga tauhan, tagpuan, storyboard, at video clip ang script o sipi ng nobela para sa maikling kuwento sa makivue. Sundin ang halimbawa ng eksenang may tatlong shot.',
                keywords: ['script tungo sa AI video', 'nobela bilang video', 'kuwento tungo sa video', 'AI maikling pelikula', 'script to video tutorial', 'adaptasyon ng nobela sa AI'],
                heading: 'Mula sa nakasulat na eksena tungo sa magkakaugnay na kuha',
                intro: 'Kailangan ng tuloy-tuloy na kuwento ang ayos ng mga kuha, hindi lamang isang mahabang prompt. Maghanda ng malinaw na eksena at sanggunian bago bumuo ng mga clip.',
                sections: [
                    {
                        id: 'script',
                        heading: 'Pumili ng eksenang may nakikitang pagbabago',
                        paragraphs: [
                            'Gumamit ng isang lugar, kakaunting tauhan, at malinaw na pangyayari. Gawing kilos o maikling linya ang panloob na pag-iisip. Ilagay ang ideya o script sa proseso ng kuwento, pagkatapos ay suriin ang balangkas at script ng episode bago gumawa ng mga larawan.'
                        ],
                        checklist: ['Parehong pangalan ng tauhan sa lahat ng kuha.', 'Hiwalay ang usapan at kilos.', 'May layunin ang bawat eksena.']
                    },
                    {
                        id: 'shots',
                        heading: 'Nakasulat na halimbawa: impormasyon bago ang reaksiyon',
                        paragraphs: ['Ipakita muna ang lugar, pagkatapos ang bagong impormasyon, at saka ang tugon. Nasusuri ang pag-usad ng kuwento bago gumastos sa mga larawan.'],
                        example:
                            'Malawak na kuha: naghihintay si Lina sa ilalim ng orasan ng istasyon sa takipsilim, may asul na amerikana at pulang sobre.\nMalapit na kuha: binubuksan niya ang sobre at nakikita ang tiket na may petsa bukas.\nKatamtamang kuha: tumingin siya sa bakanteng plataporma at sinabi, “May oras pa pala.”'
                    },
                    {
                        id: 'produce',
                        heading: 'Suriin ang mga sanggunian bago ang video',
                        paragraphs: [
                            'Ihanda ang sangguniang larawan ng tauhan at istasyon, saka paghambingin ang storyboard. Pumili ng modelo at haba na angkop sa bawat kuha. Suriin ang kilos, tunog, at dugtungan bago pagsamahin ang episode; ulitin lamang ang bahaging kailangan ng pagbabago.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Maaari bang gawing AI video ang nobela?',
                        answer: 'Oo, magsimula sa isang sipi. Gawing nakikitang kilos ang salaysay, suriin ang adaptasyon ng script, at ihanda ang mga tauhan at kuha bago palawakin ang kuwento.'
                    },
                    {
                        question: 'Buong pelikula ba ang isang pagbuo?',
                        answer: 'May limitasyon sa haba ang bawat modelo. Karaniwang kailangan ng mahabang kuwento ang maraming clip, mga sanggunian, pagpaplano ng kuha, at pagsasama ng resulta.'
                    },
                    {
                        question: 'Kailan titingnan ang gastos?',
                        answer: 'Bago ang bawat yugto ng pagbuo. May singil sa teksto, larawan, at video ayon sa modelo at paggamit. Hindi ginagarantiya ng 1,000 credit ang tapos na maikling pelikula.'
                    }
                ]
            },
            'manga-storyboard': {
                title: 'AI manga storyboard: mula sa banghay tungo sa mga panel',
                description:
                    'Hatiin ang banghay sa malinaw na panel at kuha na may kilos, komposisyon, at usapan para sa animasyong may estilong manga. Suriin ang pagkakasunod gamit ang limang-panel na halimbawa.',
                keywords: ['AI manga storyboard', 'banghay tungo sa storyboard', 'manga storyboard generator', 'AI manga panel', 'manga storyboard tutorial', 'komposisyon ng manga panel'],
                heading: 'Ayusin ang banghay bilang madaling sundang manga storyboard',
                intro: 'Sinasabi ng banghay ang nangyayari; pinipili ng storyboard kung kailan makikita ang impormasyon. Gamitin ang mga panel bilang yunit ng pagpaplano para sa animasyon.',
                sections: [
                    {
                        id: 'beats',
                        heading: 'Isang tungkulin sa kuwento bawat panel',
                        paragraphs: [
                            'Isulat ang layunin ng tauhan, bagong impormasyon, at reaksiyon. Bigyan ng isang pangunahing tungkulin ang bawat panel bago sumulat ng prompt. Piliin ang estilo ng proyekto, saka ihanda ang mga sanggunian ng tauhan at tagpuan.'
                        ]
                    },
                    {
                        id: 'example',
                        heading: 'Nakasulat na halimbawa: pagtuklas sa bubong',
                        paragraphs: [
                            'Mas malinaw ang pagtuklas kapag nakita muna ang bagay bago ang reaksiyon. Ang pagkakasunod na ito ay plano ng larawan at video, hindi pangakong pahina ng manga na handang ilimbag.'
                        ],
                        example:
                            '1. Malawak na kuha: dumating sa basang bubong ang mensaherang may dilaw na dyaket.\n2. Detalye: kumikislap ang radyo sa tabi ng tubig.\n3. Katamtamang kuha: kinuha niya ang radyo.\n4. Malapit na kuha: nakasabit dito ang keychain ng kapatid niya.\n5. Reaksiyon: lumingon siya sa hagdan.',
                        checklist: ['Ipakilala ang lugar bago ang detalye.', 'Panatilihin ang direksiyon ng tingin at bagay.', 'Iangkop ang usapan sa haba ng kuha.']
                    },
                    {
                        id: 'review',
                        heading: 'Paghambingin ang mga panel bago galawin',
                        paragraphs: [
                            'Panatilihin ang dyaket, buhok, at paleta. Suriin ang lokasyon ng hagdan at radyo sa lahat ng larawan. Ayusin ang nagbago na pose o bagay bago bumuo ng video, pagkatapos ay pumili ng galaw at haba na suportado ng modelo.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Sapat ba ang banghay para sa storyboard?',
                        answer: 'Panimulang materyal ito. Hatiin sa nakikitang kilos, pagtuklas, at reaksiyon, pagkatapos ay itakda ang komposisyon, tauhan, at lugar ng bawat kuha.'
                    },
                    {
                        question: 'May export ba ng manga na handang ilimbag?',
                        answer: 'Ang prosesong ito ay naghahanda ng panel at storyboard para sa video. Hindi ipinapangako ng gabay ang paglalatag o pag-export ng manga para sa paglimbag.'
                    },
                    {
                        question: 'Dapat bang isang clip ang bawat panel?',
                        answer: 'Hindi. Tinutulungan ng panel ang ayos ng impormasyon. Pagsamahin o paghiwalayin ang mga kuha ayon sa kilos at mga haba at sangguniang suportado ng modelo.'
                    }
                ]
            },
            'consistent-ai-characters': {
                title: 'Pare-parehong AI tauhan: mga sanggunian sa bawat kuha',
                description:
                    'Maghanda ng malinaw na sangguniang larawan at pare-parehong paglalarawan upang suriin ang mga tauhan sa storyboard at video. Tukuyin ang pagbabago sa mukha at damit sa bawat shot.',
                keywords: [
                    'pare-parehong AI tauhan',
                    'pagkakapareho ng AI character',
                    'iisang tauhan sa maraming larawan',
                    'AI character reference',
                    'AI character consistency guide',
                    'ayusin ang nagbabagong AI face'
                ],
                heading: 'Panatilihing nakikilala ang tauhan sa bawat kuha',
                intro: 'Nagsisimula ang pagkakapareho bago gumawa ng video. Nakakatulong ang malinaw na sanggunian at matatag na paglalarawan, ngunit hindi garantisado ang eksaktong parehong pagkakakilanlan.',
                sections: [
                    {
                        id: 'reference',
                        heading: 'Pumili ng madaling suriing sanggunian',
                        paragraphs: [
                            'Gumawa muna ng larawang malinaw ang mukha, buhok, at kasuotan. Aprubahan ang disenyo bago ang ibang kuha. Ulitin ang mahahalagang katangian sa halip na baguhin ang paglalarawan ng tauhan sa bawat hiling.'
                        ],
                        checklist: ['Parehong pangalan at kasuotan.', 'Malinaw ang mahalagang gamit.', 'Angkop ang liwanag sa tagpuan.']
                    },
                    {
                        id: 'example',
                        heading: 'Nakasulat na halimbawa: hiwalay ang katangian at kilos',
                        paragraphs: [
                            'Ang matatag na katangian ang batayan ng disenyo; ang pose at komposisyon ay para sa partikular na kuha. Nabago ang kilos nang hindi sinasadyang baguhin ang tauhan.'
                        ],
                        example:
                            'Mga katangian: Lina, maikling itim na buhok, asul na amerikana, maliit na pulang sobre.\nBagong kuha: nakatayo si Lina sa tabi ng bangko ng istasyon, nakatingin sa riles, katamtamang kuha, liwanag ng takipsilim. Gamitin ang aprubadong sanggunian; panatilihin ang buhok, amerikana, at sobre.'
                    },
                    {
                        id: 'sequence',
                        heading: 'Suriin ang buong pagkakasunod',
                        paragraphs: [
                            'Paghambingin ang mukha, kamay, kasuotan, at gamit sa mga larawan at sa buong video. Hindi garantiya ng magandang simula ang magandang dulo. Ayusin ang kuhang lumihis bago pagsamahin at pumili ng modelong tumatanggap ng kinakailangang sanggunian.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Ginagarantiya ba ng sanggunian ang parehong mukha?',
                        answer: 'Hindi. Ginagabayan nito ang modelo, pero maaaring magbago ang mukha, damit, at gamit. Paghambingin ang resulta at ayusin ang mga kuhang lumihis.'
                    },
                    {
                        question: 'Anong katangian ang dapat ulitin?',
                        answer: 'Buhok, kasuotan, hugis, at mahalagang gamit na nagpapakilala sa tauhan. Isulat nang hiwalay ang pose, komposisyon, at liwanag ng kuha.'
                    },
                    {
                        question: 'Bakit suriin ang larawan bago ang video?',
                        answer: 'Maaaring madala sa clip ang mali sa mukha o kasuotan. Ang maagang pagsusuri ng storyboard at sanggunian ay nakakatulong bawasan ang mahal na pag-ulit ng video.'
                    }
                ]
            },
            'image-to-video': {
                title: 'Gabay sa larawan tungo sa AI video: materyal, galaw, at dulo',
                description:
                    'Pumili ng malinaw na larawan, sumulat ng simpleng galaw, at suriin ang pagpapatuloy upang gumawa ng AI video mula sa litrato o ilustrasyon. Gumamit ng motion example at suriin ang dulo ng shot.',
                keywords: [
                    'gabay larawan tungo sa AI video',
                    'galawin ang larawan gamit ang AI',
                    'litrato bilang video AI',
                    'prompt larawan tungo sa video',
                    'image to video tutorial',
                    'AI camera motion prompts'
                ],
                heading: 'Ihanda ang larawan para sa malinaw na galaw',
                intro: 'Ang larawan ang komposisyon, ang prompt ang galaw. Suriin ang materyal at pumili ng kilos na akma sa frame bago bumuo ng clip.',
                sections: [
                    {
                        id: 'source',
                        heading: 'Suriin ang larawan bago ang animasyon',
                        paragraphs: [
                            'Pumili ng malinaw na tauhan, kamay, at mahahalagang bagay. Tingnan ang pag-crop at espasyo para sa kilos. Ayusin muna ang depekto ng larawan bago dalhin sa gumagalaw na resulta.'
                        ],
                        checklist: ['Nababasa ang mukha at gamit.', 'May puwang para sa kilos.', 'Kapani-paniwala ang hugis ng tagpuan.']
                    },
                    {
                        id: 'motion',
                        heading: 'Nakasulat na halimbawa: isang pangunahing galaw',
                        paragraphs: ['Ilarawan ang nagbabago at ang kailangang manatiling matatag. Mas madaling suriin ang tauhan at tagpuan kapag maliit at malinaw ang kilos.'],
                        example:
                            'Gamitin ang larawan ng mensahera bilang sangguniang biswal. Dahan-dahan siyang lilingon sa pinto ng bubong at hihinto. Bahagyang gagalaw sa hangin ang dilaw na dyaket. Nakatigil ang kamera, matatag ang likuran, parehong liwanag ng takipsilim, walang pagpapalit ng eksena.'
                    },
                    {
                        id: 'ending',
                        heading: 'Tingnan ang simula, buong galaw, at dulo',
                        paragraphs: [
                            'Pumili ng modelong tumatanggap ng larawan at haba na suportado nito. Iba-iba ang pangkalahatang sanggunian at una o huling frame. Panoorin ang buong clip para sa pagbabago ng mukha, lumulutang na gamit, o di-inaasahang kamera bago gumawa ng susunod na kuha.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Laging eksaktong unang frame ba ang larawan?',
                        answer: 'Hindi. May modelong gumagamit ng panimulang frame at may pangkalahatang sanggunian. Suriin ang napiling paraan bago magplano ng eksaktong transisyon.'
                    },
                    {
                        question: 'Maaari bang litrato o ilustrasyon?',
                        answer: 'Oo, kung suportado ng modelo at malinaw ang materyal. Piliin ang galaw na akma sa komposisyon at suriin ang mga pagbabago sa resulta.'
                    },
                    {
                        question: 'Paano gumawa ng mahabang eksena?',
                        answer: 'Hatiin sa mga kilos at clip na pasok sa haba ng modelo. Suriin ang dulo at dugtungan; hindi ginagarantiya ng isang larawan ang matatag na mahabang kuwento.'
                    }
                ]
            },
            'ai-anime-video': {
                title: 'AI anime video: magplano ng maikling animadong kuwento',
                description: 'Piliin ang estilo, tauhan, storyboard, at kilos para sa AI anime, pagkatapos ay suriin ang bawat clip bago pagsamahin. Suriin ang estilo, keyframe, tunog at final edit.',
                keywords: ['AI anime video', 'anime generator AI', 'AI animadong kuwento', 'paggawa ng anime AI', 'AI anime video tutorial', 'anime character reference'],
                heading: 'Gumawa ng anime na may malinaw na direksiyong biswal',
                intro: 'Magsimula sa maikling eksena, isang tauhan, at napiling estilo. Nakakatulong ang paghahanda ng larawan sa kuwento at disenyo bago ang animasyon.',
                sections: [
                    {
                        id: 'style',
                        heading: 'Itakda ang estilo at katangian',
                        paragraphs: [
                            'Piliin ang paleta, linya, at anino, pagkatapos ay maghanda ng tauhan at tagpuan. Suriin kung malinaw ang mga detalye sa target na format. Kailangan pa ring tingnan ang mukha, kasuotan, at gamit kahit estilong anime.'
                        ]
                    },
                    {
                        id: 'example',
                        heading: 'Nakasulat na halimbawa: kuwento sa tatlong kuha',
                        paragraphs: ['Mas madaling ayusin ang ritmo ng maikling kilos kaysa mahabang buod. Ginagabayan ng ayos na ito ang larawan at pagbabago ng damdamin.'],
                        example:
                            'Malawak na kuha: pumasok sa hardin sa umaga ang mag-aaral na may berdeng uniporme.\nDetalye: dumapo sa kamay niya ang kumikinang na paru-paro.\nKatamtamang kuha: dahan-dahan niyang itinaas ang ulo patungo sa puno, nagtataka. Nakatigil ang kamera, berde at gintong paleta, malambot na anino.',
                        checklist: ['Iisang estilo sa lahat ng kuha.', 'Isang pangunahing kilos bawat clip.', 'Dulong magagamit sa dugtungan.']
                    },
                    {
                        id: 'produce',
                        heading: 'Galawin at suriin ang bawat kuha',
                        paragraphs: [
                            'Bumuo at paghambingin muna ang storyboard bago pumili ng video na suportado ang sanggunian at haba. Tingnan ang linya, kamay, at galaw. Kung may boses at subtitle, suriin ang tiyempo, pagkatapos ay pagsamahin ang clip ayon sa kuwento.'
                        ]
                    }
                ],
                faqs: [
                    {
                        question: 'Sapat ba ang isang anime image sa buong episode?',
                        answer: 'Maaari itong sanggunian o simula ng isang kuha. Kailangan ng episode ang maraming pangyayari, angkop na larawan, at pagsusuri ng dugtungan.'
                    },
                    {
                        question: 'Paano panatilihin ang estilo?',
                        answer: 'Gamitin nang pare-pareho ang paleta, linya, anino, at aprubadong sanggunian. Paghambingin ang resulta dahil maaari pa rin itong lumihis.'
                    },
                    {
                        question: 'Lahat ba ng modelo ay may usapan at tunog?',
                        answer: 'Hindi. Iba-iba ang kakayahang audio at mga opsiyon. Tingnan muna bago isulat ang eksenang umaasa sa usapan o kasabay na tunog.'
                    }
                ]
            }
        },
        tools: {
            'ai-image-generator': {
                title: 'AI image generator para sa mga tauhan, tagpuan, at kuwento',
                description: 'Bumuo ng AI larawan mula sa teksto o sanggunian para sa mga tauhan, tagpuan, at biswal ng kuwento sa makivue. Pumili ng modelo, aspect ratio at estilo bago bumuo.',
                keywords: ['AI image generator', 'AI larawan', 'AI tauhan', 'AI tagpuan', 'AI concept art generator', 'storyboard image generator'],
                heading: 'Ihanda ang mga larawang nagbibigay-hugis sa kuwento',
                intro: 'Pumili ng tauhan, lugar, o konsepto ng pabalat. Tuklasin ang bagong ideya sa teksto o ipagpatuloy ang napiling disenyo gamit ang sangguniang larawan.',
                actionLabel: 'Bumuo ng AI larawan',
                features: [
                    { heading: 'Dalawang panimulang materyal', text: 'Gumamit ng paglalarawan o angkop na sanggunian. Nakadepende sa modelo ang mga suportadong input.' },
                    { heading: 'May malinaw na gamit ang bawat asset', text: 'Hiwalay na suriin ang mukha at damit ng tauhan sa ayos at liwanag ng tagpuan.' },
                    { heading: 'Handa para sa susunod na yugto', text: 'Piliin ang angkop na proporsiyon. Kailangan ng pabalat ang espasyo sa teksto at ng animasyon ang puwang sa kilos.' }
                ],
                steps: [
                    { heading: 'Itakda ang larawan', text: 'Ilarawan ang isang paksa, lugar, komposisyon, at estilo. Iwasan ang maraming di-kaugnay na larawan sa isang hiling.' },
                    { heading: 'Piliin ang mga setting', text: 'Buksan ang lugar ng larawan, pumili ng modelo at proporsiyon, at tingnan ang sanggunian at presyo.' },
                    { heading: 'Suriin ang resulta', text: 'Tingnan ang kamay, mukha, at gamit. Baguhin ang isang problema, saka i-download ang napiling larawan.' }
                ],
                useCases: [
                    { heading: 'Konsepto ng tauhan', text: 'Subukan ang hugis, kasuotan, at buhok bago gumawa ng maraming kuha ng pangunahing tauhan.' },
                    { heading: 'Tagpuan at pabalat', text: 'Maghanda ng malinaw na komposisyon at damdamin; idagdag ang huling pamagat sa angkop na prosesong pangdisenyo.' }
                ],
                example: {
                    heading: 'Nakasulat na halimbawa: madaling suriing tauhan',
                    prompt: 'Batang mensahera na may dilaw na kapote, maikling itim na buhok, at maliit na bag na canvas, nakatayo sa pintuan ng bubong sa takipsilim. Katamtamang malawak na kuha, malinaw na mukha, banayad na liwanag, asul at dilaw na paleta, ilustrasyong sinematiko, simpleng likuran.',
                    note: 'Nakasulat na prompt ito, hindi nabuong halimbawa. Suriin ang tauhan bago ibang pose o animasyon.'
                },
                faqs: [
                    {
                        question: 'Kailan teksto o larawang sanggunian?',
                        answer: 'Teksto para tuklasin ang ideya; sanggunian para sa umiiral na tauhan, komposisyon, o estilo. Tingnan ang suportado ng modelo.'
                    },
                    {
                        question: 'Maaari bang gumawa ng materyal para sa drama?',
                        answer: 'Oo. Ihanda ang tauhan at lugar, saka paghambingin bago gamitin sa storyboard o video. Kailangan pa ring suriin ang pagkakapareho.'
                    },
                    {
                        question: 'Walang hanggan ba ang pagsubok?',
                        answer: 'Hindi. May 1,000 credit ang bagong account. Gumagamit ng balanse ang pagbuo ayon sa modelo at aktuwal na paggamit; tingnan ang presyo.'
                    }
                ]
            },
            'text-to-image': {
                title: 'Teksto tungo sa AI larawan: gawing biswal ang paglalarawan',
                description: 'Isulat ang paksa, lugar, komposisyon, at liwanag upang gumawa ng AI larawan mula sa teksto para sa iyong konsepto. Piliin ang komposisyon, ilaw, estilo at aspect ratio.',
                keywords: ['teksto tungo sa AI larawan', 'larawan mula sa teksto', 'text to image AI', 'prompt para sa larawan', 'character concept prompts', 'AI scene image prompts'],
                heading: 'Bigyan ng nakikitang anyo ang paglalarawan',
                intro: 'Kung walang sanggunian, magsimula sa tiyak na prompt. Ipinapakita ng larawan ang isang kalagayan, hindi buong banghay; piliin ang detalyeng masusuri mo.',
                actionLabel: 'Gumawa ng larawan mula sa teksto',
                features: [
                    { heading: 'Nakikitang detalye', text: 'Ilarawan ang paksa, pose, lugar, komposisyon, at liwanag. Gawing nakikitang bagay ang abstraktong ideya.' },
                    { heading: 'Pagtuklas bago ang sanggunian', text: 'Ihambing ang konsepto, pumili ng direksiyon, at itabi ang larawan at mga katangian para sa susunod.' },
                    { heading: 'Proporsiyon para sa gamit', text: 'Magkaiba ang komposisyon ng portrait, malawak na lugar, at patayong larawan. Tingnan ang crop at sentro ng pansin.' }
                ],
                steps: [
                    { heading: 'Sumulat ng isang larawan', text: 'Magsimula sa paksa at lugar, saka idagdag ang damit, gamit, liwanag, at estilo nang walang salungat na tagubilin.' },
                    { heading: 'Pumili ng modelo at format', text: 'Ilagay ang paglalarawan at tingnan ang proporsiyon, opsiyon, at gastos bago bumuo.' },
                    { heading: 'Baguhin ang isang pasiya', text: 'Kung tama ang komposisyon ngunit mali ang liwanag, liwanag lamang ang baguhin upang makabuluhan ang paghahambing.' }
                ],
                useCases: [
                    { heading: 'Ilarawan ang lugar ng kuwento', text: 'Linawin ang ayos ng plataporma o silid bago magplano ng kuha at posisyon ng tauhan.' },
                    { heading: 'Maghanda ng larawang gagalaw', text: 'Ilagay nang malinaw ang paksa at maglaan ng puwang para sa planong kilos.' }
                ],
                example: {
                    heading: 'Nakasulat na halimbawa: malinaw na lugar',
                    prompt: 'Bakanteng plataporma ng tren sa bughaw na takipsilim, lumang bilog na orasan sa ibabaw ng bangkong kahoy, basang sahig na sumasalamin sa mainit na ilaw. Malawak na kuha sa taas ng plataporma, bangko sa kaliwa at riles sa kanan, natural na proporsiyon, makatotohanang sinematikong estilo.',
                    note: 'Inihahanda ng nakasulat na prompt ang lugar. Planuhin nang hiwalay ang kuha para sa kilos ng tauhan.'
                },
                faqs: [
                    { question: 'Kailangan ba ng panimulang larawan?', answer: 'Hindi sa text-only na pagbuo na suportado ng modelo. Ilarawan ang larawan, pumili ng format, at suriin ang resulta.' },
                    {
                        question: 'Ano ang ilalagay sa prompt?',
                        answer: 'Paksa, tagpuan, pose, komposisyon, liwanag, at estilo. Unahin ang mahalaga; mahirap isama sa isang larawan ang maraming lugar at magkakasunod na kilos.'
                    },
                    {
                        question: 'Maaari bang gawing video ang resulta?',
                        answer: 'Oo, gamitin ang aprubadong larawan sa angkop na video task. Ilarawan nang hiwalay ang galaw at suriin ang buong clip.'
                    }
                ]
            },
            'image-to-image': {
                title: 'Larawan tungo sa AI larawan: lumikha gamit ang sanggunian',
                description:
                    'Gamitin ang sangguniang larawan at prompt upang gumawa ng bagong tauhan, komposisyon, o damdamin, saka paghambingin ang pagbabago. Sabihin kung alin ang pananatilihin at babaguhin.',
                keywords: ['larawan tungo sa AI larawan', 'AI larawan mula sa larawan', 'sangguniang larawan AI', 'bagong bersiyon ng larawan AI', 'AI image variations', 'reference image prompts'],
                heading: 'Ipagpatuloy ang larawan nang may malinaw na direksiyon',
                intro: 'Itakda ang papel ng sanggunian: paksa, komposisyon, o estilo. Ihiwalay ang katangiang pananatilihin sa pagbabagong hinihiling bago bumuo.',
                actionLabel: 'Gumawa gamit ang sangguniang larawan',
                features: [
                    { heading: 'Malinaw na tungkulin ng sanggunian', text: 'Sabihin kung susundan ang kasuotan, ayos ng lugar, o paleta ng unang larawan.' },
                    { heading: 'Tiyak na pagbabago', text: 'Humiling ng isang bagong pose o liwanag bawat pagkakataon. Hindi naka-lock ang lahat ng detalye dahil sa sanggunian.' },
                    { heading: 'Pagsusuri bago ang video', text: 'Tingnan ang mukha, gamit, at posisyon bago gamitin sa maraming kuha upang maagang makita ang paglihis.' }
                ],
                steps: [
                    { heading: 'Pumili ng malinaw na materyal', text: 'Dapat madaling makita ang paksa at katangian. Iwasan ang sobrang siksik o malabong sanggunian.' },
                    { heading: 'Isulat ang pagkakaiba', text: 'I-upload sa angkop na modelo, ilista ang matatag na katangian, at piliin ang bagong komposisyon.' },
                    { heading: 'Paghambingin at itabi', text: 'Tingnan ang resulta kasabay ng orihinal. I-download ang aprubadong bersiyon o ayusin ang di-kanais-nais na pagbabago.' }
                ],
                useCases: [
                    { heading: 'Ibang anggulo ng tauhan', text: 'Subukan ang pose at komposisyon gamit ang aprubadong sanggunian, saka suriin ang pagkakakilanlan.' },
                    { heading: 'Ibang damdamin ng lugar', text: 'Baguhin ang liwanag habang tinitingnan ang pinto, bintana, at gamit na mahalaga sa eksena.' }
                ],
                example: {
                    heading: 'Nakasulat na halimbawa: bagong komposisyon',
                    prompt: 'Gamitin ang mensahera sa sangguniang larawan. Panatilihin ang maikling itim na buhok, dilaw na kapote, at bag na canvas. Katamtamang kuha sa tabi ng pinto ng bubong, nakatingin sa radyo, banayad na liwanag ng takipsilim, ilustrasyong sinematiko, simpleng likuran.',
                    note: 'Hindi garantisado ang eksaktong mukha at gamit. Paghambingin ang bagong resulta at sanggunian.'
                },
                faqs: [
                    { question: 'Eksaktong pag-edit ba ito ng orihinal?', answer: 'Bagong pagbuo ito na ginagabayan ng larawan at teksto. Maaaring magbago ang detalyeng hiniling na manatili.' },
                    {
                        question: 'Maaari bang palitan ang estilo?',
                        answer: 'Oo, sa modelong may sanggunian at wastong prompt. Suriin pati paksa at komposisyon; hindi garantisadong eksaktong mapapanatili ang mga ito.'
                    },
                    {
                        question: 'Ano ang kaibhan sa larawan tungo sa video?',
                        answer: 'Bagong nakatigil na larawan ang una; galaw ang idinadagdag ng ikalawa. Ayusin muna ang biswal kung hindi pa handa ang disenyo.'
                    }
                ]
            },
            'text-to-video': {
                title: 'Teksto tungo sa AI video: gumawa ng clip mula sa prompt',
                description:
                    'Ilarawan ang eksena, kilos ng paksa, at kamera upang bumuo ng AI clip mula sa teksto gamit ang angkop na modelo at haba. Magplano ng isang kilos at direksiyon ng kamera bawat shot.',
                keywords: ['teksto tungo sa AI video', 'video mula sa teksto AI', 'prompt bilang video', 'AI video clip', 'AI video motion prompts', 'maiikling AI video clip'],
                heading: 'Isulat ang eksena at galaw para sa AI video',
                intro: 'Kung walang panimulang larawan, ilarawan ang lugar at pagbabago habang tumatakbo ang clip. Limitahan ang kilos upang madaling masuri ang resulta.',
                actionLabel: 'Gumawa ng video mula sa teksto',
                features: [
                    { heading: 'Malinaw na galaw', text: 'Pumili ng isang pangunahing kilos at malinaw na kamera. Kailangan ng prompt sa video ang galaw, hindi anyo lamang.' },
                    { heading: 'Modelo para sa kuha', text: 'Iba-iba ang haba, audio, sanggunian, at presyo. Tingnan ang opsiyon bago humiling ng usapan o komplikadong kilos.' },
                    { heading: 'Maraming clip para sa kuwento', text: 'Sumusunod sa limitasyon ng modelo ang bawat pagbuo. Gumamit ng script at storyboard para sa mahabang eksena o episode.' }
                ],
                steps: [
                    { heading: 'Planuhin ang simula at dulo', text: 'Piliin ang lugar, paksa, at pangunahing kilos. Ilipat sa ibang kuha ang mga dagdag na pangyayari.' },
                    { heading: 'Ilagay ang prompt', text: 'Buksan ang lugar ng video at pumili ng modelo, proporsiyon, at suportadong haba, saka tingnan ang gastos.' },
                    { heading: 'Panoorin ang buong kilos', text: 'Suriin ang galaw, gamit, kamera, at dulo. Pasimplehin ang hiling kung minamadali ang kilos.' }
                ],
                useCases: [
                    { heading: 'Kuha para sa kapaligiran', text: 'Maaaring ipakilala ng bakanteng kalye o mahanging plataporma ang lugar bago ang mga tauhan.' },
                    { heading: 'Pagsubok ng galaw', text: 'Subukan ang simpleng kilos bago ang mahabang eksena; gumamit ng sanggunian kung mahalaga ang tiyak na disenyo.' }
                ],
                example: {
                    heading: 'Nakasulat na halimbawa: isang layunin sa galaw',
                    prompt: 'Bakanteng plataporma sa takipsilim, mainit na ilaw sa basang sahig. Dahan-dahang dumudulas ang tiket na papel sa harapan dahil sa mahinang hangin, saka humihinto sa tabi ng bangko. Malawak na kuha, nakatigil na kamera, makatotohanang sinematikong estilo, walang lipat ng lugar.',
                    note: 'Piliin ang suportadong haba. Nakadepende sa modelo ang tunog at usapan; hindi garantiya ng resulta ang nakasulat na halimbawa.'
                },
                faqs: [
                    {
                        question: 'Kailangan bang mag-upload ng larawan?',
                        answer: 'Hindi sa text-only na task na suportado ng modelo. Ilarawan ang eksena at galaw, pumili ng setting, at suriin ang clip.'
                    },
                    {
                        question: 'Buong pelikula ba ang isang prompt?',
                        answer: 'Isang clip sa limitasyon ng modelo ang bawat hiling. Karaniwang kailangan ng pelikula ang maraming kuha, sanggunian, at pagsasama.'
                    },
                    { question: 'May tunog ba ang video?', answer: 'Nakadepende sa modelo at napiling opsiyon. Tingnan muna ang kakayahan bago ang eksenang may usapan o kasabay na tunog.' }
                ]
            },
            'image-to-video': {
                title: 'Larawan tungo sa AI video: galawin ang litrato o ilustrasyon',
                description:
                    'Magdagdag ng larawan, ilarawan ang kilos, at pumili ng angkop na modelo upang gumawa ng AI clip mula sa nakatigil na biswal. Suriin ang karakter at background sa buong clip.',
                keywords: ['larawan tungo sa AI video', 'litrato bilang video AI', 'galawin larawan AI', 'video mula sa larawan AI', 'still image animation', 'AI video mula sa illustration'],
                heading: 'Bigyan ng planadong galaw ang nakatigil na larawan',
                intro: 'Magsimula sa biswal na nasuri na. Larawan ang direksiyong biswal, prompt ang kilos, paggalaw ng kapaligiran, at kamera.',
                actionLabel: 'Gumawa ng video mula sa larawan',
                features: [
                    { heading: 'Nasuring materyal', text: 'Tingnan ang mukha, kamay, gamit, at crop. Maaaring madala sa clip ang mali sa larawan.' },
                    { heading: 'Kilos na may matatag na detalye', text: 'Sabihin ang gagalaw at mananatili. Iwasan ang nakatigil na kamera at mabilis na pag-ikot sa iisang hiling.' },
                    { heading: 'Sanggunian ayon sa modelo', text: 'Magkaiba ang una, huling frame, at pangkalahatang sanggunian. Tingnan ang paraan at suportadong haba.' }
                ],
                steps: [
                    { heading: 'Ihanda ang larawan', text: 'Pumili ng malinaw na komposisyon na may puwang sa kilos. Ayusin ang depekto bago ang animasyon.' },
                    { heading: 'Idagdag ang larawan at galaw', text: 'Gumamit ng modelong tumatanggap ng sanggunian, ilarawan ang isang kilos, at piliin ang angkop na proporsiyon at haba.' },
                    { heading: 'Suriin ang dulo ng clip', text: 'Tingnan ang mukha, gamit, at kamera sa buong haba. Hindi garantiya ng magandang simula ang magagamit na dulo.' }
                ],
                useCases: [
                    { heading: 'Reaksiyon ng tauhan', text: 'Galawin ang ulo o maliit na pose habang sinusuri ang mukha at kasuotan.' },
                    { heading: 'Gumagalaw na tagpuan', text: 'Subukan ang ulan, kurtina, o banayad na kamera habang tinitingnan ang anyo at ayos ng lugar.' }
                ],
                example: {
                    heading: 'Nakasulat na halimbawa: walang pagbabago ng eksena',
                    prompt: 'Gamitin ang larawan ng mensahera bilang sanggunian. Dahan-dahan siyang lilingon sa pinto at hihinto. Bahagyang gagalaw ang dilaw na kapote sa hangin. Nakatigil ang kamera, matatag ang likuran, parehong liwanag ng takipsilim, walang pagpapalit ng eksena.',
                    note: 'Nakadepende sa modelo ang paraan ng sanggunian. Panoorin ang buong resulta upang suriin ang tauhan at gamit.'
                },
                faqs: [
                    {
                        question: 'Maaari bang litrato o ilustrasyon?',
                        answer: 'Oo sa angkop na modelo at malinaw na materyal. Pumili ng kapani-paniwalang kilos at suriin ang pagbabago ng mukha at tagpuan.'
                    },
                    {
                        question: 'Eksaktong unang frame ba ang materyal?',
                        answer: 'Hindi palagi. May panimulang frame at pangkalahatang sanggunian. Suriin ang opsiyon bago magplano ng eksaktong transisyon.'
                    },
                    {
                        question: 'Maaari bang mahabang eksena?',
                        answer: 'Sumusunod ang bawat hiling sa haba ng modelo. Kailangan ng mahabang kuwento ang maraming kuha, pagsusuri ng dulo, at storyboard para sa pagpapatuloy.'
                    }
                ]
            }
        }
    }
}
