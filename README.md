# ShareBite Backend

Backend API for ShareBite - A platform that connects donors (restaurants, households) with receivers (NGOs, shelters) to redistribute surplus food efficiently, transparently, and safely.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Update the `.env` file with your MongoDB connection string and JWT secret.

4. Make sure MongoDB is running on your system.

5. Start the development server:
```bash
npm run dev
```

The server will run on `http://localhost:5000` by default.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user (donor or receiver)
- `POST /api/auth/login` - Login user

### Donors
- `GET /api/donors` - Get all donors
- `GET /api/donors/:id` - Get donor by ID
- `GET /api/donors/:id/donations` - Get donations by a specific donor

### Receivers
- `GET /api/receivers` - Get all receivers
- `GET /api/receivers/:id` - Get receiver by ID
- `GET /api/receivers/:id/donations` - Get donations received by a specific receiver

### Donations
- `GET /api/donations` - Get all donations (optionally filter by status)
- `GET /api/donations/available` - Get all available donations
- `POST /api/donations` - Create a new donation
- `GET /api/donations/:id` - Get donation by ID
- `PATCH /api/donations/:id/reserve` - Reserve/claim a donation
- `PATCH /api/donations/:id/status` - Update donation status

## Models

- **User**: Represents both donors and receivers
- **Donation**: Represents food donations with items, pickup details, and status





