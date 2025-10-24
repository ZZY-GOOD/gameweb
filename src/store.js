import { reactive, watch } from 'vue';
import { supabase } from './supabase.js';

const STORAGE_KEY = 'game_forum_store_v1';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function newId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function parseGallery(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g.filter(Boolean);
  return String(g).split(',').map(s => s.trim()).filter(Boolean);
}

function parseGenres(genres, fallback) {
  if (!genres && fallback) return [fallback].filter(Boolean);
  if (Array.isArray(genres)) return genres.filter(Boolean);
  const s = String(genres || '').trim();
  return s ? [s] : [];
}

const defaultState = {
  user: null,
  /* 用户资料与关系 */
  profiles: {},           /* { [name]: { avatar?: string } } */
  relations: {},          /* { [name]: { followers: string[], following: string[] } } */
  /* 全局搜索 */
  searchGame: '',
  searchForum: '',
  games: [
    {
      id: 'game_demo',
      title: '示例游戏：永夜传说',
      company: '星环工作室',
      price: 128,
      genre: '角色扮演',
      genres: ['角色扮演'],
      background: '在永夜笼罩的大陆，玩家踏上寻找曙光的旅途。',
      gameplay: '开放世界探索 + 回合制战斗 + 队伍养成。',
      officialUrl: 'https://example.com/demo-game',
      cover: '',
      gallery: [
        'https://picsum.photos/seed/game1/1200/600',
        'https://picsum.photos/seed/game2/1200/600',
        'https://picsum.photos/seed/game3/1200/600'
      ],
      createdAt: Date.now(),
      ratings: [] // 每条：{ id, stars(1-5), createdAt }
    }
  ],
  posts: [
    {
      id: 'post_demo',
      title: '新人报道：永夜传说初体验',
      author: '小明',
      content: '战斗节奏不错，剧情也挺吸引人。你们都玩到哪了？',
      createdAt: Date.now(),
      likes: 3,
      comments: [
        { id: newId('c'), author: '路人甲', content: '刚打完第一章 Boss！', createdAt: Date.now() }
      ]
    }
  ]
};

/* 数据迁移：兼容旧结构并兜底缺失字段 */
function migrate(data) {
  const base = JSON.parse(JSON.stringify(defaultState));
  const src = data && typeof data === 'object' ? data : {};
  base.user = src.user ?? base.user;

  base.games = Array.isArray(src.games) ? src.games : base.games;
  base.posts = Array.isArray(src.posts) ? src.posts : base.posts;

  base.profiles = src.profiles && typeof src.profiles === 'object' ? src.profiles : {};
  base.relations = src.relations && typeof src.relations === 'object' ? src.relations : {};

  base.games = base.games.map(g => ({
    ...g,
    gallery: parseGallery(g.gallery),
    genres: parseGenres(g.genres, g.genre?.trim() || '未分类')
  }));
  base.posts = base.posts.map(p => ({
    ...p,
    images: Array.isArray(p.images) ? p.images : []
  }));
  return base;
}

const persisted = load();
export const store = reactive(migrate(persisted));

watch(store, (s) => save(s), { deep: true });

export async function addGame(game) {
  const id = newId('g');
  const title = game.title?.trim() || '未命名游戏';
  const company = game.company?.trim() || '未知公司';
  const price = Number(game.price) || 0;
  const genre = (game.genre?.trim() || (Array.isArray(game.genres) && game.genres[0]) || '未分类');
  const genres = parseGenres(game.genres, (game.genre?.trim() || '未分类'));
  const background = game.background?.trim() || '';
  const gameplay = game.gameplay?.trim() || '';
  const officialUrl = game.officialUrl?.trim() || '';
  const cover = game.cover?.trim() || '';
  const gallery = parseGallery(game.gallery);
  const creatorName = store.user?.name || '匿名';
  
  let supabaseGameId = null; // 保存Supabase返回的游戏ID
  
  // 1. 首先保存到本地
  const newGame = {
    id,
    title,
    company,
    price,
    genre,
    genres,
    background,
    gameplay,
    officialUrl,
    cover,
    gallery,
    createdAt: Date.now(),
    creator: creatorName,
    supabase_id: null // 添加supabase_id字段
  };
  store.games.unshift(newGame);
  
  // 2. 然后保存到 Supabase
  try {
    // 获取当前登录用户的ID
    const currentUserId = store.user?.id;
    
    const { data, error } = await supabase
      .from('games')
      .insert([
        {
          title: title,
          company: company,
          price: price,
          genres: genres, // 使用数组格式
          background: background,
          gameplay: gameplay,
          official_url: officialUrl,
          cover_url: cover,
          creator: currentUserId, // 关联到用户ID
          created_at: new Date().toISOString()
        }
      ])
      .select();
    
    if (error) {
      console.error('保存游戏到Supabase失败:', error);
      // 即使Supabase保存失败，也返回本地ID，保证用户体验
      return { localId: id, supabaseId: null };
    }
    
    console.log('游戏已保存到Supabase:', data);
    
    // 保存Supabase返回的UUID
    if (data && data.length > 0) {
      supabaseGameId = data[0].id;
      // 更新本地游戏的supabase_id字段
      newGame.supabase_id = supabaseGameId;
    }
    
  } catch (error) {
    console.error('保存游戏过程中出错:', error);
  }
  
  return { localId: id, supabaseId: supabaseGameId };
}

export function getGame(id) {
  return store.games.find(g => g.id === id);
}

export function addRating(gameId, stars) {
  const g = getGame(gameId);
  if (!g) return null;
  const s = Math.min(5, Math.max(1, Number(stars) || 0));
  const id = newId('r');
  if (!Array.isArray(g.ratings)) g.ratings = [];
  g.ratings.push({ id, stars: s, createdAt: Date.now() });
  return id;
}

export function getAverageStars(g) {
  const list = Array.isArray(g?.ratings) ? g.ratings : [];
  if (list.length === 0) return 0;
  const sum = list.reduce((acc, x) => acc + (Number(x.stars) || 0), 0);
  return Math.round((sum / list.length) * 10) / 10;
}

export async function addPost(post) {
  const id = newId('p');
  const authorName = post.author?.trim() || store.user?.name || '匿名';
  const title = post.title?.trim() || '无标题';
  const content = post.content?.trim() || '';
  
  let supabasePostId = null; // 保存Supabase返回的帖子ID
  
  // 1. 首先保存到本地
  const newPost = {
    id,
    title,
    author: authorName,
    content,
    createdAt: Date.now(),
    likes: 0,
    images: Array.isArray(post.images) ? post.images : [],
    comments: [],
    supabase_id: null // 添加supabase_id字段
  };
  store.posts.unshift(newPost);
  
  // 2. 然后保存到 Supabase
  try {
    // 获取当前登录用户的ID
    const currentUserId = store.user?.id;
    
    const { data, error } = await supabase
      .from('posts')
      .insert([
        {
          title: title,
          author_id: currentUserId, // 关联到用户ID
          author_name: authorName,  // 保存作者名字快照
          content: content,
          likes: 0,
          created_at: new Date().toISOString()
        }
      ])
      .select();
    
    if (error) {
      console.error('保存帖子到Supabase失败:', error);
      // 即使Supabase保存失败，也返回本地ID，保证用户体验
      return { localId: id, supabaseId: null };
    }
    
    console.log('帖子已保存到Supabase:', data);
    
    // 保存Supabase返回的UUID
    if (data && data.length > 0) {
      supabasePostId = data[0].id;
      // 更新本地帖子的supabase_id字段
      newPost.supabase_id = supabasePostId;
    }
    
  } catch (error) {
    console.error('保存帖子过程中出错:', error);
  }
  
  return { localId: id, supabaseId: supabasePostId };
}

export function getPost(id) {
  return store.posts.find(p => p.id === id);
}

// 为现有帖子创建Supabase记录（如果不存在）
async function ensurePostHasSupabaseId(post) {
  if (post.supabase_id) {
    return post.supabase_id;
  }
  
  try {
    // 获取当前登录用户的ID
    const currentUserId = store.user?.id;
    
    const { data, error } = await supabase
      .from('posts')
      .insert([
        {
          title: post.title,
          author_id: currentUserId,
          author_name: post.author,
          content: post.content,
          likes: post.likes || 0,
          created_at: new Date(post.createdAt).toISOString()
        }
      ])
      .select();
    
    if (error) {
      console.error('为现有帖子创建Supabase记录失败:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      const supabaseId = data[0].id;
      post.supabase_id = supabaseId;
      console.log('已为现有帖子创建Supabase记录:', supabaseId);
      return supabaseId;
    }
  } catch (error) {
    console.error('为现有帖子创建Supabase记录过程中出错:', error);
  }
  
  return null;
}

export async function addComment(postId, comment) {
  const p = getPost(postId);
  if (!p) return null;
  const id = newId('c');
  const authorName = comment.author?.trim() || store.user?.name || '匿名';
  const content = comment.content?.trim() || '';
  
  // 1. 首先保存到本地
  const newComment = {
    id,
    author: authorName,
    content,
    createdAt: Date.now()
  };
  p.comments.push(newComment);
  
  // 2. 然后尝试保存到 Supabase
  try {
    // 获取当前登录用户的ID
    const currentUserId = store.user?.id;
    
    // 使用帖子的Supabase ID（如果存在）
    let supabasePostId = p.supabase_id;
    
    // 如果没有Supabase ID，尝试为现有帖子创建Supabase记录
    if (!supabasePostId) {
      supabasePostId = await ensurePostHasSupabaseId(p);
      if (!supabasePostId) {
        console.warn('无法为帖子创建Supabase记录，跳过数据库保存');
        return id;
      }
    }
    
    // 检查用户是否已登录（需要author_id）
    if (!currentUserId) {
      console.warn('用户未登录，跳过数据库保存');
      return id;
    }
    
    const { data, error } = await supabase
      .from('comments')
      .insert([
        {
          post_id: supabasePostId, // 使用Supabase的帖子UUID
          author_id: currentUserId, // 关联到用户ID
          author_name: authorName,  // 保存作者名字快照
          content: content,
          created_at: new Date().toISOString()
        }
      ])
      .select();
    
    if (error) {
      console.error('保存评论到Supabase失败:', error);
      // 即使Supabase保存失败，也返回本地ID，保证用户体验
      return id;
    }
    
    console.log('评论已保存到Supabase:', data);
    
  } catch (error) {
    console.error('保存评论过程中出错:', error);
  }
  
  return id;
}

export function likePost(postId) {
  const p = getPost(postId);
  if (!p) return null;
  p.likes = (p.likes || 0) + 1;
  return p.likes;
}

/* 用户状态（本地持久化） */
export function getUser() {
  return store.user || null;
}

// 检查用户名或邮箱是否已存在
async function isUserExists(username, email) {
  try {
    // 检查用户名是否已存在
    if (username) {
      const { data: usernameData, error: usernameError } = await supabase
        .from('profiles')
        .select('id')
        .eq('name', username)
        .single();
      
      if (usernameData && !usernameError) {
        return true;
      }
    }
    
    // 检查邮箱是否已存在
    if (email) {
      const { data: emailData, error: emailError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();
      
      if (emailData && !emailError) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('检查用户存在性时出错:', error);
    return false;
  }
}

export async function signUp(payload) {
  const username = (payload?.username || '').trim();
  const email = (payload?.email || '').trim();
  const password = (payload?.password || '').trim();
  
  // 基本校验
  if (!username || username.length < 3) {
    return false;
  }
  if (!email || !email.includes('@')) {
    return false;
  }
  if (!password || password.length < 6) {
    return false;
  }
  
  try {
    // 检查用户名或邮箱是否已存在
    const exists = await isUserExists(username, email);
    if (exists) {
      return false;
    }
    
    // 1. 首先在Supabase Auth中创建用户
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          username: username
        }
      }
    });
    
    if (authError) {
      console.error('Supabase Auth注册失败:', authError);
      return false;
    }
    
    if (!authData.user) {
      return false;
    }
    
    // 2. 在profiles表中创建用户档案
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .insert([
        {
          id: authData.user.id,
          name: username,
          avatar_url: null
          // created_at 字段有默认值，不需要手动设置
        }
      ])
      .select();
    
    if (profileError) {
      console.error('创建用户档案失败:', profileError);
      // 如果档案创建失败，可能需要回滚Auth用户创建
      return false;
    }
    
    // 3. 设置当前登录用户
    store.user = {
      id: authData.user.id,
      name: username,
      username: username,
      email: email,
      createdAt: new Date().toISOString()
    };
    
    // 4. 同时保存到本地profiles
    store.profiles[username] = store.user;
    
    return true;
  } catch (error) {
    console.error('注册过程中出错:', error);
    return false;
  }
}

export async function signIn(payload, opts = {}) {
  const email = (payload?.email || '').trim();
  const password = (payload?.password || '').trim();
  
  try {
    // 简单校验：邮箱需含 @；密码非空
    if (!email.includes('@') || !password) return false;
    
    // 使用Supabase Auth进行邮箱登录
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });
    
    if (authError) {
      console.error('Supabase Auth登录失败:', authError);
      return false;
    }
    
    if (!authData.user) {
      return false;
    }
    
    // 获取用户档案信息
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    
    if (profileError) {
      console.error('获取用户档案失败:', profileError);
      return false;
    }
    
    // 设置当前登录用户
    store.user = {
      id: authData.user.id,
      name: profileData.name,
      email: authData.user.email,
      username: profileData.name,
      avatar_url: profileData.avatar_url,
      createdAt: profileData.created_at
    };
    
    // 保存到本地profiles
    store.profiles[profileData.name] = store.user;
    
    return true;
  } catch (error) {
    console.error('登录过程中出错:', error);
    return false;
  }
}
export function signOut() {
  store.user = null;
}

/* 头像与社交关系 */
export function updateAvatar(dataUrl) {
  if (!store.user) return false;
  store.user.avatar = dataUrl;
  const name = store.user.name;
  if (!store.profiles[name]) store.profiles[name] = {};
  store.profiles[name].avatar = dataUrl;
  return true;
}
export function getAvatarByName(name) {
  return store.profiles?.[name]?.avatar || null;
}
function ensureRel(name) {
  if (!store.relations[name]) store.relations[name] = { followers: [], following: [] };
  return store.relations[name];
}
export function isFollowing(targetName) {
  const me = store.user?.name;
  if (!me || !targetName) return false;
  return (ensureRel(me).following).includes(targetName);
}
export function followUser(targetName) {
  const me = store.user?.name;
  if (!me || !targetName || me === targetName) return false;
  const my = ensureRel(me); const his = ensureRel(targetName);
  if (!my.following.includes(targetName)) my.following.push(targetName);
  if (!his.followers.includes(me)) his.followers.push(me);
  return true;
}
export function unfollowUser(targetName) {
  const me = store.user?.name;
  if (!me || !targetName) return false;
  const my = ensureRel(me); const his = ensureRel(targetName);
  my.following = my.following.filter(n => n !== targetName);
  his.followers = his.followers.filter(n => n !== me);
  // 触发响应式
  store.relations = { ...store.relations, [me]: my, [targetName]: his };
  return true;
}
export function followersOf(name) {
  return ensureRel(name).followers.map(n => ({ id: n, name: n, avatar: getAvatarByName(n) }));
}
export function followingOf(name) {
  return ensureRel(name).following.map(n => ({ id: n, name: n, avatar: getAvatarByName(n) }));
}