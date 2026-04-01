// Application principale RiskManager

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const logoutBtn = document.getElementById('logout-btn');
    const riskList = document.getElementById('risk-list');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const success = await Auth.login(email, password);
            if (success) {
                window.location.href = 'dashboard.html';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            Auth.logout();
            window.location.href = 'index.html';
        });
    }

    if (riskList) {
        loadRisks();
    }
});

async function loadRisks() {
    const riskList = document.getElementById('risk-list');
    const risks = await Api.getRisks();
    riskList.innerHTML = risks.length
        ? risks.map(r => `<div class="risk-item"><strong>${r.name}</strong><p>${r.description}</p></div>`).join('')
        : '<p>Aucun risque enregistré.</p>';
}
