
const express = require('express');
const session = require('express-session');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const deezer = require('./deezer');
const supabase = require('./supabase');

const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: 'resonanse-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

function verificarLogin(req, res, next) {
    if (!req.session.logado) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                erro: 'Faça login para acessar.'
            });
        }

        return res.redirect('/login');
    }

    next();
}

function limitarResultados(valor, padrao = 12, maximo = 100) {
    const numero = parseInt(valor, 10);

    if (isNaN(numero)) return padrao;

    return Math.min(Math.max(numero, 1), maximo);
}

function obterOffset(valor) {
    const numero = parseInt(valor, 10);

    if (isNaN(numero)) return 0;

    return Math.max(numero, 0);
}

function tratarErro(res, mensagem, erro) {
    console.error(mensagem, erro.message);

    res.status(500).json({
        erro: mensagem
    });
}

async function obterClienteAutenticado(req) {
    if (!req.session.accessToken || !req.session.refreshToken) {
        const erro = new Error('Sessão expirada. Entre novamente.');
        erro.status = 401;
        throw erro;
    }

    const cliente = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        }
    );

    const { data, error } = await cliente.auth.setSession({
        access_token: req.session.accessToken,
        refresh_token: req.session.refreshToken
    });

    if (error || !data.session) {
        const erroSessao = new Error('Sua sessão expirou. Entre novamente.');
        erroSessao.status = 401;
        throw erroSessao;
    }

    req.session.accessToken = data.session.access_token;
    req.session.refreshToken = data.session.refresh_token;

    return cliente;
}

function iniciarSessao(req, res, usuario, sessaoSupabase) {
    req.session.regenerate(erro => {
        if (erro) {
            console.error('Erro ao criar sessão:', erro);

            return res.status(500).json({
                erro: 'Não foi possível iniciar sua sessão.'
            });
        }

        req.session.logado = true;
        req.session.usuarioId = usuario.id;
        req.session.email = usuario.email;
        req.session.accessToken = sessaoSupabase.access_token;
        req.session.refreshToken = sessaoSupabase.refresh_token;

        req.session.save(erro => {
            if (erro) {
                console.error('Erro ao salvar sessão:', erro);

                return res.status(500).json({
                    erro: 'Não foi possível salvar sua sessão.'
                });
            }

            res.json({
                sucesso: true
            });
        });
    });
}

function normalizarLancamento(item, tipo = 'album') {
    const artista = item.artist || item.album?.artist || {};

    const capa = item.cover_big ||
        item.cover_medium ||
        item.album?.cover_big ||
        item.album?.cover_medium ||
        null;

    const tipoLancamento = tipo === 'single'
        ? 'Single'
        : 'Album';

    return {
        ...item,
        id: item.id,
        title: item.title,
        name: item.title,
        artist: artista,
        'artist-credit': artista.name
            ? [{
                name: artista.name,
                artist: {
                    id: artista.id,
                    name: artista.name
                }
            }]
            : [],
        cover_url: capa,
        image: capa,
        date: item.release_date || item.album?.release_date || null,
        'primary-type': tipoLancamento,
        record_type: item.record_type || tipo
    };
}

// LOGIN E CADASTRO

app.get('/login', (req, res) => {
    if (req.session.logado) {
        return res.redirect('/');
    }

    res.sendFile(path.join(__dirname, 'teladelogin.html'));
});

app.get('/cadastro', (req, res) => {
    if (req.session.logado) {
        return res.redirect('/');
    }

    res.sendFile(path.join(__dirname, 'teladecadastro.html'));
});

app.post('/cadastro', async (req, res) => {
    try {
        const nome = req.body.nome?.trim();
        const email = req.body.email?.trim().toLowerCase();
        const senha = req.body.senha;
        const confirmarSenha = req.body.confirmarSenha;

        if (!nome || !email || !senha || !confirmarSenha) {
            return res.status(400).json({
                erro: 'Preencha todos os campos.'
            });
        }

        if (senha.length < 6) {
            return res.status(400).json({
                erro: 'A senha precisa ter pelo menos 6 caracteres.'
            });
        }

        if (senha !== confirmarSenha) {
            return res.status(400).json({
                erro: 'As senhas não são iguais.'
            });
        }

        const { data, error } = await supabase.auth.signUp({
            email,
            password: senha,
            options: {
                data: {
                    nome
                }
            }
        });

        if (error) {
            console.error('Erro no cadastro:', error.message);

            return res.status(400).json({
                erro: error.message
            });
        }

        if (!data.user) {
            return res.status(400).json({
                erro: 'Não foi possível criar sua conta.'
            });
        }

        if (data.user.identities && data.user.identities.length === 0) {
            return res.status(409).json({
                erro: 'Este email já possui uma conta.'
            });
        }

        if (!data.session) {
            return res.status(400).json({
                erro: 'A sessão não foi criada. Confira a confirmação de email no Supabase.'
            });
        }

        iniciarSessao(req, res, data.user, data.session);
    } catch (erro) {
        console.error('Erro inesperado no cadastro:', erro);

        res.status(500).json({
            erro: 'Ocorreu um problema ao criar sua conta.'
        });
    }
});

app.post('/login', async (req, res) => {
    try {
        const email = req.body.email?.trim().toLowerCase();
        const senha = req.body.senha;

        if (!email || !senha) {
            return res.status(400).json({
                erro: 'Preencha o email e a senha.'
            });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password: senha
        });

        if (error) {
            console.error('Erro no login:', error.message);

            return res.status(401).json({
                erro: error.message
            });
        }

        iniciarSessao(req, res, data.user, data.session);
    } catch (erro) {
        console.error('Erro inesperado no login:', erro);

        res.status(500).json({
            erro: 'Ocorreu um problema ao fazer login.'
        });
    }
});

// AVALIAÇÕES

app.get('/api/avaliacoes/:tipo/:id', verificarLogin, async (req, res) => {
    try {
        const tipo = req.params.tipo;
        const itemId = req.params.id;

        if (!['album', 'single', 'artista'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo de avaliação inválido.'
            });
        }

        const cliente = await obterClienteAutenticado(req);

        const { data, error } = await cliente
            .from('Avaliacoes')
            .select('nota, usuario_id')
            .eq('tipo', tipo)
            .eq('item_id', itemId);

        if (error) throw error;

        const avaliacoes = data || [];
        const quantidade = avaliacoes.length;

        const soma = avaliacoes.reduce(
            (total, avaliacao) => total + Number(avaliacao.nota),
            0
        );

        const media = quantidade > 0
            ? Number((soma / quantidade).toFixed(1))
            : null;

        const minhaAvaliacao = avaliacoes.find(
            avaliacao => avaliacao.usuario_id === req.session.usuarioId
        );

        res.json({
            media,
            quantidade,
            minhaAvaliacao: minhaAvaliacao
                ? Number(minhaAvaliacao.nota)
                : null
        });
    } catch (erro) {
        if (erro.status === 401) {
            return res.status(401).json({
                erro: erro.message
            });
        }

        tratarErro(res, 'Não foi possível consultar as avaliações.', erro);
    }
});

app.post('/api/avaliacoes', verificarLogin, async (req, res) => {
    try {
        const tipo = req.body.tipo;
        const itemId = String(req.body.itemId || '').trim();
        const nota = Number(req.body.nota);

        if (!['album', 'single', 'artista'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo de avaliação inválido.'
            });
        }

        if (!itemId || itemId.length > 100) {
            return res.status(400).json({
                erro: 'Identificador do item inválido.'
            });
        }

        if (
            !Number.isFinite(nota) ||
            nota < 0 ||
            nota > 10 ||
            !Number.isInteger(nota * 2)
        ) {
            return res.status(400).json({
                erro: 'A nota deve estar entre 0 e 10, em intervalos de 0,5.'
            });
        }

        const cliente = await obterClienteAutenticado(req);

        const { data, error } = await cliente
            .from('Avaliacoes')
            .upsert({
                usuario_id: req.session.usuarioId,
                tipo,
                item_id: itemId,
                nota,
                atualizado_em: new Date().toISOString()
            }, {
                onConflict: 'usuario_id,tipo,item_id'
            })
            .select('id, nota')
            .single();

        if (error) throw error;

        res.json({
            sucesso: true,
            mensagem: 'Avaliação salva com sucesso.',
            avaliacao: data
        });
    } catch (erro) {
        if (erro.status === 401) {
            return res.status(401).json({
                erro: erro.message
            });
        }

        tratarErro(res, 'Não foi possível salvar sua avaliação.', erro);
    }
});

// COMENTÁRIOS

app.get('/api/comentarios/:tipo/:id', verificarLogin, async (req, res) => {
    try {
        const tipo = req.params.tipo;
        const itemId = req.params.id;

        if (!['album', 'single', 'artista'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo de comentário inválido.'
            });
        }

        const cliente = await obterClienteAutenticado(req);

        const { data, error } = await cliente
            .from('Comentarios')
            .select(`
                id,
                usuario_id,
                comentario,
                criado_em,
                usuario:Usuarios(nome)
            `)
            .eq('tipo', tipo)
            .eq('item_id', itemId)
            .order('criado_em', { ascending: false })
            .limit(100);

        if (error) throw error;

        const comentarios = (data || []).map(item => ({
            id: item.id,
            usuario_id: item.usuario_id,
            nome: item.usuario?.nome || 'Usuário',
            comentario: item.comentario,
            criado_em: item.criado_em,
            meuComentario: item.usuario_id === req.session.usuarioId
        }));

        res.json({
            comentarios
        });
    } catch (erro) {
        if (erro.status === 401) {
            return res.status(401).json({
                erro: erro.message
            });
        }

        tratarErro(res, 'Não foi possível carregar os comentários.', erro);
    }
});

app.post('/api/comentarios', verificarLogin, async (req, res) => {
    try {
        const tipo = req.body.tipo;
        const itemId = String(req.body.itemId || '').trim();
        const comentario = String(req.body.comentario || '').trim();

        if (!['album', 'single', 'artista'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo de comentário inválido.'
            });
        }

        if (!itemId || itemId.length > 100) {
            return res.status(400).json({
                erro: 'Identificador do item inválido.'
            });
        }

        if (!comentario || comentario.length > 1000) {
            return res.status(400).json({
                erro: 'O comentário deve ter entre 1 e 1000 caracteres.'
            });
        }

        const cliente = await obterClienteAutenticado(req);

        const { data, error } = await cliente
            .from('Comentarios')
            .insert({
                usuario_id: req.session.usuarioId,
                tipo,
                item_id: itemId,
                comentario
            })
            .select(`
                id,
                usuario_id,
                comentario,
                criado_em,
                usuario:Usuarios(nome)
            `)
            .single();

        if (error) throw error;

        res.status(201).json({
            sucesso: true,
            mensagem: 'Comentário publicado com sucesso.',
            comentario: {
                id: data.id,
                usuario_id: data.usuario_id,
                nome: data.usuario?.nome || 'Usuário',
                comentario: data.comentario,
                criado_em: data.criado_em,
                meuComentario: true
            }
        });
    } catch (erro) {
        if (erro.status === 401) {
            return res.status(401).json({
                erro: erro.message
            });
        }

        tratarErro(res, 'Não foi possível publicar o comentário.', erro);
    }
});

app.delete('/api/comentarios/:id', verificarLogin, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                erro: 'Identificador de comentário inválido.'
            });
        }

        const cliente = await obterClienteAutenticado(req);

        const { data, error } = await cliente
            .from('Comentarios')
            .delete()
            .eq('id', id)
            .select('id')
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                erro: 'Comentário não encontrado ou você não tem permissão para excluí-lo.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: 'Comentário excluído.'
        });
    } catch (erro) {
        if (erro.status === 401) {
            return res.status(401).json({
                erro: erro.message
            });
        }

        tratarErro(res, 'Não foi possível excluir o comentário.', erro);
    }
});

// PÁGINAS

app.get('/', verificarLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'telainicial.html'));
});

app.get('/album', verificarLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'exebicaodealbum.html'));
});

app.get('/artista', verificarLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'artista.html'));
});

app.get('/igor', verificarLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'album.html'));
});

app.get('/tyler', verificarLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'artista.html'));
});

app.get('/singles', verificarLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'singles.html'));
});

// CATÁLOGO

app.get('/api/catalogo', verificarLogin, async (req, res) => {
    try {
        const tipo = req.query.tipo || 'album';
        const pesquisa = req.query.q?.trim() || 'popular';

        if (!['album', 'single'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo inválido.'
            });
        }

        const limite = limitarResultados(req.query.limit);
        const offset = obterOffset(req.query.offset);

        let resposta;

        if (tipo === 'album') {
            resposta = await deezer.buscarAlbuns(
                pesquisa,
                limite,
                offset
            );

            resposta.data = resposta.data.map(item =>
                normalizarLancamento(item, 'album')
            );
        } else {
            resposta = await deezer.buscarSingles(
                pesquisa,
                limite,
                offset
            );

            resposta.data = resposta.data.map(item =>
                normalizarLancamento(item, 'single')
            );
        }

        res.json(resposta);
    } catch (erro) {
        tratarErro(res, 'Não foi possível carregar o catálogo.', erro);
    }
});

app.get('/api/artistas', verificarLogin, async (req, res) => {
    try {
        const pesquisa = req.query.q?.trim() || 'Tyler';
        const limite = limitarResultados(req.query.limit);
        const offset = obterOffset(req.query.offset);

        const dados = await deezer.buscarArtistas(
            pesquisa,
            limite,
            offset
        );

        res.json(dados);
    } catch (erro) {
        tratarErro(res, 'Não foi possível carregar artistas.', erro);
    }
});

app.get('/api/artistas/:id', verificarLogin, async (req, res) => {
    try {
        const dados = await deezer.buscarArtista(req.params.id);

        res.json(dados);
    } catch (erro) {
        tratarErro(res, 'Não foi possível buscar o artista.', erro);
    }
});

app.get('/api/lancamentos', verificarLogin, async (req, res) => {
    try {
        const pesquisa = req.query.q;
        const tipo = req.query.tipo || 'todos';

        if (!pesquisa || !pesquisa.trim()) {
            return res.status(400).json({
                erro: 'Informe o nome do lançamento.'
            });
        }

        if (!['album', 'single', 'todos'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo inválido.'
            });
        }

        const limite = limitarResultados(req.query.limit, 25);
        const offset = obterOffset(req.query.offset);

        let dados;

        if (tipo === 'album') {
            dados = await deezer.buscarAlbuns(
                pesquisa,
                limite,
                offset
            );

            dados.data = dados.data.map(item =>
                normalizarLancamento(item, 'album')
            );
        } else if (tipo === 'single') {
            dados = await deezer.buscarSingles(
                pesquisa,
                limite,
                offset
            );

            dados.data = dados.data.map(item =>
                normalizarLancamento(item, 'single')
            );
        } else {
            const [albuns, singles] = await Promise.all([
                deezer.buscarAlbuns(pesquisa, limite, offset),
                deezer.buscarSingles(pesquisa, limite, offset)
            ]);

            const resultados = [
                ...albuns.data.map(item =>
                    normalizarLancamento(item, 'album')
                ),
                ...singles.data.map(item =>
                    normalizarLancamento(item, 'single')
                )
            ];

            dados = {
                data: resultados,
                total: albuns.total + singles.total
            };
        }

        res.json(dados);
    } catch (erro) {
        tratarErro(res, 'Não foi possível pesquisar lançamentos.', erro);
    }
});

app.get('/api/lancamentos/:id', verificarLogin, async (req, res) => {
    try {
        const dados = await deezer.buscarAlbum(req.params.id);

        res.json(dados);
    } catch (erro) {
        tratarErro(res, 'Não foi possível buscar o lançamento.', erro);
    }
});

app.get('/api/capas/alternativa', verificarLogin, async (req, res) => {
    try {
        const titulo = req.query.titulo?.trim();

        if (!titulo) {
            return res.status(400).json({
                erro: 'Informe o título do lançamento.'
            });
        }

        const dados = await deezer.buscarAlbuns(titulo, 10, 0);

        const capa = dados.data.find(item =>
            item.title.toLowerCase() === titulo.toLowerCase()
        )?.cover_big || dados.data[0]?.cover_big || null;

        res.json({
            capa
        });
    } catch (erro) {
        tratarErro(res, 'Não foi possível buscar a capa alternativa.', erro);
    }
});

app.get('/api/artistas/:id/lancamentos', verificarLogin, async (req, res) => {
    try {
        const tipo = req.query.tipo || 'todos';

        if (!['album', 'single', 'todos'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo inválido.'
            });
        }

        const limite = limitarResultados(req.query.limit, 100);
        const offset = obterOffset(req.query.offset);

        const resposta = await deezer.buscarAlbunsArtista(
            req.params.id,
            limite,
            offset
        );

        let lancamentos = resposta.data || [];

        if (tipo === 'album') {
            lancamentos = lancamentos.filter(item =>
                item.record_type === 'album' ||
                item.record_type === 'ep'
            );
        }

        if (tipo === 'single') {
            lancamentos = lancamentos.filter(item =>
                item.record_type === 'single'
            );
        }

        lancamentos = lancamentos.map(item =>
            normalizarLancamento(
                item,
                item.record_type === 'single' ? 'single' : 'album'
            )
        );

        res.json({
            ...resposta,
            data: lancamentos
        });
    } catch (erro) {
        tratarErro(res, 'Não foi possível carregar a discografia.', erro);
    }
});

app.get('/api/generos', verificarLogin, async (req, res) => {
    try {
        const limite = limitarResultados(req.query.limit, 100);
        const offset = obterOffset(req.query.offset);

        const resposta = await deezer.buscarGeneros();

        const generos = resposta.data || [];

        res.json({
            data: generos.slice(offset, offset + limite),
            total: generos.length
        });
    } catch (erro) {
        tratarErro(res, 'Não foi possível carregar os gêneros.', erro);
    }
});

app.get('/api/generos/:nome/lancamentos', verificarLogin, async (req, res) => {
    try {
        const genero = req.params.nome.trim();
        const tipo = req.query.tipo || 'todos';

        if (!['album', 'single', 'todos'].includes(tipo)) {
            return res.status(400).json({
                erro: 'Tipo inválido.'
            });
        }

        const limite = limitarResultados(req.query.limit, 25);
        const offset = obterOffset(req.query.offset);

        const resposta = await deezer.buscarAlbuns(
            genero,
            limite,
            offset
        );

        let lancamentos = resposta.data || [];

        if (tipo === 'album') {
            lancamentos = lancamentos.filter(item =>
                item.record_type === 'album' ||
                item.record_type === 'ep'
            );
        }

        if (tipo === 'single') {
            lancamentos = lancamentos.filter(item =>
                item.record_type === 'single'
            );
        }

        res.json({
            ...resposta,
            data: lancamentos
        });
    } catch (erro) {
        tratarErro(res, 'Não foi possível carregar os lançamentos do gênero.', erro);
    }
});

// BUSCA E LOGOUT

app.get('/buscar', verificarLogin, (req, res) => {
    const pesquisa = req.query.q;

    if (!pesquisa) {
        return res.redirect('/');
    }

    res.redirect('/?q=' + encodeURIComponent(pesquisa));
});

app.get('/logout', (req, res) => {
    req.session.destroy(erro => {
        if (erro) {
            console.error('Erro ao encerrar sessão:', erro);
        }

        res.redirect('/login');
    });
});

app.use(express.static(__dirname));

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
