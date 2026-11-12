
const axios = require('axios');

const api = axios.create({
    baseURL: 'https://api.deezer.com',
    timeout: 15000
});

async function buscarArtistas(pesquisa, limite = 12, indice = 0) {
    const resposta = await api.get('/search/artist', {
        params: {
            q: pesquisa,
            limit: limite,
            index: indice
        }
    });

    return resposta.data;
}

async function buscarArtista(id) {
    const resposta = await api.get(`/artist/${id}`);
    return resposta.data;
}

async function buscarAlbuns(pesquisa, limite = 25, indice = 0) {
    const resposta = await api.get('/search/album', {
        params: {
            q: pesquisa,
            limit: limite,
            index: indice
        }
    });

    return resposta.data;
}

async function buscarSingles(pesquisa, limite = 25, indice = 0) {
    const resposta = await api.get('/search/track', {
        params: {
            q: pesquisa,
            limit: limite,
            index: indice
        }
    });

    return resposta.data;
}

async function buscarAlbunsArtista(id, limite = 100, indice = 0) {
    const resposta = await api.get(`/artist/${id}/albums`, {
        params: {
            limit: limite,
            index: indice
        }
    });

    return resposta.data;
}

async function buscarAlbum(id) {
    const resposta = await api.get(`/album/${id}`);
    return resposta.data;
}

async function buscarFaixasAlbum(id) {
    const resposta = await api.get(`/album/${id}/tracks`);
    return resposta.data;
}

async function buscarGeneros() {
    const resposta = await api.get('/genre');
    return resposta.data;
}

async function buscarArtistasGenero(id, limite = 25) {
    const resposta = await api.get(`/genre/${id}/artists`, {
        params: {
            limit: limite
        }
    });

    return resposta.data;
}

module.exports = {
    buscarArtistas,
    buscarArtista,
    buscarAlbuns,
    buscarSingles,
    buscarAlbunsArtista,
    buscarAlbum,
    buscarFaixasAlbum,
    buscarGeneros,
    buscarArtistasGenero
};
