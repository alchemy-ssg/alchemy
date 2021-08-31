// Import dependencies:
const fs = require('fs');
const yaml = require('yaml');
const ejs = require('ejs');
const hljs = require('highlight.js');
const md = require('markdown-it')({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }

    return '';
  }
})
  .use(require('markdown-it-checkbox'))
  md.use(require("markdown-it-anchor"), {})
  md.use(require("markdown-it-table-of-contents"))
const less = require('less');
const chokidar = require('chokidar');
const path = require('path');

const build = () => {
  // Build file structure for the new site
  (fs.existsSync('site') && fs.lstatSync('site').isDirectory()) || fs.mkdirSync('site');
  (fs.existsSync('site/assets') && fs.lstatSync('site/assets').isDirectory()) || fs.mkdirSync('site/assets');
  (fs.existsSync('site/assets/css') && fs.lstatSync('site/assets/css').isDirectory()) || fs.mkdirSync('site/assets/css');

  // Parse configuration file:
  const config = yaml.parse(
    fs.readFileSync('config.yaml', 'utf-8')
  );

  // Load on-page search data
  const searchdata = fs.existsSync('search_data.json') ? JSON.parse(fs.readFileSync('search_data.json', 'utf-8')) : undefined;

  // Parse stylesheet: (right now no support for imports)
  const less_input = fs.readFileSync(`theme/styles/main.less`, 'utf-8');
  less.render(less_input, {
    root: '.'
  })
    .then(output => {
      fs.writeFileSync(`site/assets/css/main.css`, output.css);
    })
    .catch(err => {
      console.log(err)
    })
  
  // Parse layouts:
  let layouts = {};
  fs.readdirSync('theme/layouts').forEach(e => {
    layouts[e.replace('.ejs', '')] = fs.readFileSync(`theme/layouts/${e}`, 'utf-8')
  })

  // Generate file map:
  let filemap = [];
  const generateFmapR = (loc) => {
    fs.readdirSync(loc).forEach(e => {
      if(fs.lstatSync(path.join(loc, e)).isDirectory()) {
        generateFmapR(path.join(loc, e))
      } else {
        let markdown = fs.readFileSync(`${loc}/${e}`, 'utf-8');
        let [ignoreme, frontmatter, ...markdownbody] = markdown.split('---');
        markdownbody = markdownbody.join('---');
        frontmatter = yaml.parse(frontmatter);
        if(!frontmatter?.ignore) {
          filemap.push({
            fname: e,
            mdpath: path.join(loc, e),
            path: path.join(loc, e).replace('.md', '.html'),
            frontmatter: frontmatter,
            projectroot: path.dirname(require.main.filename),
            searchdata: searchdata
          })
        }
      }
    })
  }
  generateFmapR('./posts');
  filemap.sort(function(a, b) {
    var keyA = new Date(a.frontmatter.date);
    var keyB = new Date(b.frontmatter.date);

    if (keyA < keyB) return 1;
    if (keyA > keyB) return -1;
    return 0;
  });

  // Parse posts:
  const parsePosts = (dir) => {
    fs.readdirSync(dir).forEach(e => {
      if(fs.lstatSync(path.join(dir, e)).isDirectory()) {
        parsePosts(path.join(dir, e))
      } else {
        let markdown = fs.readFileSync(`${dir}/${e}`, 'utf-8');
        let [ignoreme, frontmatter, ...markdownbody] = markdown.split('---');
        markdownbody = markdownbody.join('---');
        try {
          frontmatter = yaml.parse(frontmatter);
        } catch (error) {
          throw new Error('Your frontmatter is malformed. Something went wrong wile parsing your frontmatter');
        }
        let parsedMarkdown = md.render(markdownbody);
        const renderedBody = ejs.render(
          fs.readFileSync(`theme/layouts/${frontmatter.layout}.ejs`, `utf-8`),
          {
            site:config,
            page:frontmatter,
            content:parsedMarkdown,
            path: path.join(dir, e).replace('.md', '.html'),
            filemap:filemap,
            projectroot: path.dirname(require.main.filename),
            searchdata: searchdata
          }
        );
        (fs.existsSync(`./site/${dir}`) && fs.lstatSync(`./site/${dir}`).isDirectory()) || fs.mkdirSync(`./site/${dir}`, {recursive:true});
        fs.writeFileSync(`./site/${dir}/${e.replace('.md', '')}.html`, renderedBody)
      }
    })
  }
  parsePosts('./posts');

  // Generate index:
  (function() {
    const renderedBody = ejs.render(
      fs.readFileSync(`theme/layouts/home.ejs`, `utf-8`),
      {
        site:config,
        page:{},
        filemap:filemap,
        path: 'index.html',
        projectroot: path.dirname(require.main.filename),
        searchdata: searchdata
      }
    );
    fs.writeFileSync('site/index.html', renderedBody)
  }());


  // Generate about page:
  (function() {
    let about__markdown = fs.readFileSync(`about.md`, 'utf-8');
    let [about__ignoreme, about__frontmatter, ...about__markdownbody] = about__markdown.split('---');
    about__markdownbody = about__markdownbody.join('---');
    
    about__frontmatter = yaml.parse(about__frontmatter);

    const parsedAbout__markdownbody = md.render(about__markdownbody)

    const about__renderedBody = ejs.render(
      fs.readFileSync(`theme/layouts/${about__frontmatter.layout}.ejs`, `utf-8`),
      {
        site:config,
        page:about__frontmatter,
        content:parsedAbout__markdownbody,
        path: 'about.html',
        projectroot: path.dirname(require.main.filename),
        searchdata: searchdata
      }
    );
    fs.writeFileSync('site/about.html', about__renderedBody)
  }());

  const copyRecursiveSync = function(src, dest) {
    var exists = fs.existsSync(src);
    var stats = exists && fs.statSync(src);
    var isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
      (fs.existsSync(`${dest}`) && fs.lstatSync(`${dest}`).isDirectory()) || fs.mkdirSync(`${dest}`, {recursive:true});
      fs.readdirSync(src).forEach(function(childItemName) {
        copyRecursiveSync(path.join(src, childItemName),
                          path.join(dest, childItemName));
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  };
  copyRecursiveSync('theme/static', 'site/assets/static');

  if(process.argv[2] == 'build') {
    require('./theme/build.js').CustomBuild({
      config:config,
      filemap:filemap
    })
  }

  // console.log('Build Complete!')
}

build();

let ready_theme = false;

if(process.argv[2] == 'watch') {
  chokidar.watch('./theme', {
    ignored: "*.js"
  })
    .on('ready', () => {console.log('Theme watching ready');ready_theme = true})
    .on('all', function(event, path) {
      if(ready_theme) {
        console.log(path, 'has changed. Rebuilding site.');
        build();
      }
    })

  let ready_posts = false;
  chokidar.watch('./posts', {
  })
    .on('ready', () => {console.log('Posts watching ready');ready_posts = true})
    .on('all', function(event, path) {
      if(ready_posts) {
        console.log(path, 'has changed. Rebuilding site.');
        build();
      }
    })
}