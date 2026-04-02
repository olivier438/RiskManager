# Risk Manager API

**ONE CIRCLE IT SOLUTIONS / Olivier Delvigne**  
Stack : Node.js 20 + Express + MySQL (Infomaniak) + Nginx

---

## Endpoints

### Auth
| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| POST | `/api/auth/login` | Public | Authentification |
| POST | `/api/auth/logout` | Auth | Révoque la session |
| GET | `/api/auth/me` | Auth | User courant |
| POST | `/api/auth/revoke-all` | Auth | Révoque toutes les sessions |

### Risks
| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| GET | `/api/risks` | Auth | Liste des risques |
| GET | `/api/risks/:id` | Auth | Détail d'un risque |
| POST | `/api/risks` | risk_manager | Créer un risque |
| PATCH | `/api/risks/:id` | Auth | Modifier un risque |
| POST | `/api/risks/:id/journal` | Auth | Ajouter une note |
| GET | `/api/risks/:id/versions` | risk_manager | Historique |

### Users
| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| GET | `/api/users` | admin | Liste des users |
| GET | `/api/users/me` | Auth | Mon profil |
| GET | `/api/users/:id` | admin/self | Profil d'un user |
| POST | `/api/users` | admin | Créer un user |
| PATCH | `/api/users/me` | Auth | Modifier mon profil |
| PATCH | `/api/users/:id/role` | admin | Changer le rôle |
| PATCH | `/api/users/:id/deactivate` | admin | Désactiver un user |
| POST | `/api/users/me/password` | Auth | Changer mon mot de passe |

### Frameworks
| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| GET | `/api/frameworks` | Auth | Frameworks actifs |
| GET | `/api/frameworks/:code/measures` | Auth | Mesures d'un framework |
| GET | `/api/frameworks/measures/suggest` | Auth | Suggestions par tags |
| GET | `/api/frameworks/stats` | Auth | Stats couverture KPI |

### Système
| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| GET | `/health` | Public | Health check |

---

## Déploiement

```bash
# 1. Cloner le repo
git clone git@github.com:olivier438/RiskManager.git
cd riskmanager-api

# 2. Copier et remplir le .env
cp .env.example .env
nano .env

# 3. Installer les dépendances
npm ci --omit=dev

# 4. Créer le dossier logs
mkdir -p logs

# 5. Démarrer avec PM2
pm2 start ecosystem.config.js --env production

# 6. Sauvegarder PM2
pm2 save
pm2 startup

# 7. Configurer Nginx
sudo cp nginx.conf /etc/nginx/sites-available/riskmanager-api
sudo ln -s /etc/nginx/sites-available/riskmanager-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. Déploiements suivants
./deploy.sh production
```

---

## Sécurité

- JWT HS256, expiry 15min, stocké en mémoire JS côté client
- Sessions en base, révocables immédiatement
- Token hashé SHA256 avant stockage — jamais le token brut
- Rate limiting double couche : Nginx + Express
- Prepared statements MySQL uniquement — zéro concaténation SQL
- CORS strict : origine whitélistée
- Headers sécurité : HSTS, CSP, X-Frame-Options, nosniff
- Body limit 50kb
- Stack traces masquées en production
- Audit log immuable sur toutes les actions sensibles
- Versioning automatique de chaque modification de risque
