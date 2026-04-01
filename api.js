// Module API - Communication avec le backend

const Api = {
    async getRisks() {
        try {
            const response = await fetch(`${Config.API_URL}/risks`, {
                headers: Auth.getAuthHeaders()
            });
            return await response.json();
        } catch (error) {
            console.error('Erreur lors de la récupération des risques:', error);
            return [];
        }
    },

    async createRisk(risk) {
        try {
            const response = await fetch(`${Config.API_URL}/risks`, {
                method: 'POST',
                headers: Auth.getAuthHeaders(),
                body: JSON.stringify(risk)
            });
            return await response.json();
        } catch (error) {
            console.error('Erreur lors de la création du risque:', error);
            return null;
        }
    }
};
