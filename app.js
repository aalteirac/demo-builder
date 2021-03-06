var express = require('express');
const fetch = require('node-fetch');
var gis = require('g-i-s');
var app = express();
var path = require('path');
const bodyParser = require('body-parser');
const https = require('https');
const http = require('http');
var xml2js  = require('xml2js');
var cors = require('cors');
var fs = require('fs');
const { json } = require('express');
const archiver = require('archiver');
Stream = require('stream').Transform;
const PAGE_SIZE=200;
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));



//DEBUG
console.log = function() {}


let port = process.env.PORT;
if (port == null || port == "") {
  port = 3000;
}

app.listen(port, function () {
  console.log('Example app listening on port '+port);
});
app.get('/', async function (req, res) {
  res.redirect("/devcenter")
})
app.post('/list', async function (req, res) {
  var m=validateParam(req,true);
  if(m!="")
    res.send({message:m});
  else  
    return list(req.protocol+'://' +req.get('host'),req.body.host,req.body.site,req.body.project,req.body.tokenName,desalt(req.body.tokenValue),res);
})
app.post('/projects', async function (req, res) {
  var m=validateParam(req);
  if(m!="")
    res.send({message:m});
    else  
      return listProjects(req.body.host,req.body.site,req.body.tokenName,desalt(req.body.tokenValue),res);
});
app.post('/workbooks', async function (req, res) {
  var m=validateParam(req);
  if(m!="")
    res.send({message:m});
    else  
      return listWorkbooks(req.body.host,req.body.site,req.body.project,req.body.tokenName,desalt(req.body.tokenValue),res);
});
app.get('/pict', function(req, res) {
  gis(req.query.search, (error, results)=>{
    var p="";
    results.map((el)=>{
      if(el.url)
        p+=`<img pages="1" page="1" loading=lazy class='searchres' src=${el.url}>`
    })
    res.send(p);
  });
})
app.get('/public', function(req, res) {
  fetch(`https://public.tableau.com/api/search/query?count=10&language=en-us&query=${encodeURIComponent(req.query.search.replace(/ /g, '+'))}&start=${req.query.start}&type=vizzes`)
  .then(response => response.json())
  .then(data => {
    res.send(data)
  });
})
app.post('/zip', async function (req, res) {
  let ret=req.body;
  let tmp=copyTemplate(ret.tpname);
  let vv=JSON.parse(ret.view).length>0?JSON.parse(ret.view)[0].val:"";
  let vvArr='"'+vv.replace(/,/g, '","')+'"';
  vvArr="var tab_server = ["+vvArr+"];"
  let ff=JSON.parse(ret.filter).length>0?JSON.parse(ret.filter)[0].val:"[]";
  let pp=JSON.parse(ret.parameter).length>0?JSON.parse(ret.parameter)[0].val:"[]";
  let war=variabilized(ret.webedit);
  let aar=variabilized(ret.askdata);
  let ttr=variabilized(ret.text);
  let imr=variabilized(ret.img);
  let acr=variabilized(ret.action);
  let wid=JSON.parse(ret.widget);
  let title=ret.title;
  vvArr+=`
  var tab_filter=${ff};
  var tab_web=${war};
  var tab_ask=${aar};
  var tab_param=${pp}; 
  var tab_text=${ttr};
  var tab_img=${imr};
  var tab_action=${acr};
  var title_index="${title}";`
  if(wid.length>0){
    wid.map((el)=>{
      el.val=el.val.replace(/'/g, '"');
      el.val=JSON.parse(el.val);
    })
    vvArr+=`
    var unique_exportID=${Date.now()};
    var widget_pos=${JSON.stringify(wid)};
    `
  }
  writeTofile(vvArr,tmp+"/lib/config.js")
  writeTofile(generateCSS(JSON.parse(ret.color)),tmp+"/css/config.css")

  var tp=req.query.tpname || 'grid';
  var zname=req.query.zname || 'demobuilder-grid.zip';
  const archive = archiver('zip');

  archive.on('error', function(err) {
    res.status(500).send({error: err.message});
  });

  archive.on('end', function() {
    deleteFolder(tmp);
  });

  res.attachment(zname);
  archive.pipe(res);

  archive.directory(tmp, '');
  archive.finalize();
});
app.post('/salt', async function (req, res) {
  res.send({salted:salt(req.body.token)});
});

function desalt(salted){
  return salted.substring(4).split("").reverse().join("");
}
function salt(token){
  if(token.indexOf("!SLT")==-1)
    return "!SLT"+token.split("").reverse().join("");
  else
    return token;  
}
function validateParam(req,for_img){
  var mess=""
  if(!req.body.host){
    mess+="Missing 'host' key in post body"
  }
  if(req.body.host){
    try {
      const url = new URL(req.body.host);
    } catch (error) {
      mess+="Host error "+error +', requires full URL with port if not 80 or 443 like http://toto.com:8080';
    }
  }
  if(!req.body.site){
    mess+="<br>Missing 'site' key in post body"
  }
  if(for_img && !req.body.project){
    mess+="<br>Missing 'project' key in post body"
  }
  if(!req.body.tokenName){
    mess+="<br>Missing 'tokenName' key in post body"
  }
  if(!req.body.tokenValue){
    mess+="<br>Missing 'tokenValue' key in post body"
  }
  return mess;

}
function listWorkbooks(rawhost,site,projectName,tokenName,tokenValue,res){
  try{
    const url = new URL(rawhost);
    var hostname=url.hostname;
    var protocol=url.protocol.replace(":","");
    var port=protocol=="https"?url.port==""?443:url.port:url.port==""?80:url.port;
    authenticate(hostname,protocol,port,site,tokenName,tokenValue).then(async (resa)=>{
      try {
        if(resa.error)
          res.send({message:resa.error});
        else{
          //manage project pagination TODO
          var pid=await getProject(protocol,port,resa.token,hostname,resa.siteid,projectName);
          if(pid==null){
            res.send({message:`No Project '${projectName}' found...`});
            return;
          }
          var pageNumber=1;
          var allWkbs=[];
          var wkbs=await getWorkbooks(protocol,port,resa.token,hostname,resa.siteid,pid,pageNumber);
          allWkbs=allWkbs.concat(wkbs.workbooks);
          pageNumber=pageNumber+1;
          var retrieved=wkbs.retrieved;
          while (retrieved<parseInt(wkbs.total)){
            var temp= await getWorkbooks(protocol,port,resa.token,hostname,resa.siteid,pid,pageNumber);
            retrieved+=temp.retrieved;
            allWkbs=allWkbs.concat(temp.workbooks);
            pageNumber=pageNumber+1;
          }
          if(allWkbs==null || (allWkbs && allWkbs.length==0)){
            res.send({message:`No Workbook found...`});
            return;
          }
          res.json(allWkbs);
        }  
      } catch (err) {
        res.send({message:err});
      }
    });
  } catch (error){
    res.send({message:error});
  }
}
function listProjects(rawhost,site,tokenName,tokenValue,res){
  try{
    const url = new URL(rawhost);
    var hostname=url.hostname;
    var protocol=url.protocol.replace(":","");
    var port=protocol=="https"?url.port==""?443:url.port:url.port==""?80:url.port;
    authenticate(hostname,protocol,port,site,tokenName,tokenValue).then(async (resa)=>{
      try {
        if(resa.error)
          res.send({message:resa.error});
        else{
          var projs=await getProjects(protocol,port,resa.token,hostname,resa.siteid);
          if(projs==null || projs.length==0){
            res.send({message:`No Project found...`});
            return;
          }
          var jso=[]
          projs[0].project.map((p)=>{
            jso.push(p.$);
          })
          res.json(jso);
        }  
      } catch (err) {
        res.send({message:err});
      }
    });
  } catch (error){
    res.send({message:error});
  }
}
function list(myhost,rawhost,site,project,tokenName,tokenValue,res){
  try{
    const url = new URL(rawhost);
    var hostname=url.hostname;
    var protocol=url.protocol.replace(":","");
    var port=protocol=="https"?url.port==""?443:url.port:url.port==""?80:url.port;
    authenticate(hostname,protocol,port,site,tokenName,tokenValue).then(async (resa)=>{
      try {
        if(resa.error)
          res.send({message:resa.error});
        else{
          var vs=await dumpViewPics(protocol,port,resa.token,hostname,resa.siteid,project);
          if(vs==null){
            res.send({message:`Project not found "${project}"`});
            return;
          }
          var jso=[]
          vs.map((v)=>{
            var js={}
            js.id=v.id;
            js.name=v.name;
            js.link=v.url;
            js.url=myhost+"/"+resa.siteid+hashCode(project)+"/"+v.id+".png";
            jso.push(js);
          })
          res.json(jso);
        }  
      } catch (err) {
        res.send({message:err});
      }
    });
  } catch (error){
    res.send({message:error});
  }
}
function deleteFolder(ptt){
  fs.rmdir(ptt, { recursive: true }, (err) => {
    if (err) {
        throw err;
    }
  });
}
function deleteImg(){
  return new Promise( (resolve, reject)=>{
    const directory = "public/";
    // fs.rmdir(directory, { recursive: true }, (err) => {
    //   resolve();
    //   if (err) {
    //       throw err;
    //   }
    // });
  })
}
function hashCode(str) {
  var hash = 0, i, chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr   = str.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; 
  }
  return hash;
}
function getImage(protocol,port,token, host,siteid, pat,viewid,wid) {
    return new Promise((resolve, reject)=>{
      //optionspath = encodeURI("/api/3.9/sites/" + siteid + "/views/" + viewid + "/image?maxAge=1&resolution=high");
      optionspath = encodeURI("/api/3.9/sites/" + siteid + "/workbooks/"+wid+"/views/" + viewid + "/previewImage");
      //optionspath = encodeURI("/api/3.9/sites/" + siteid + "/views/" + viewid + "/image?maxAge=1&resolution=high");
      var imgdata = new Stream();
      const https = require('https');
      const options = {
        hostname: host,
        port: port,
        path: optionspath,
        encoding: 'null',
        method: 'GET',
        headers: {
          'x-tableau-auth': token
        }
      }
      var proto=protocol=="https"?https:http;
      fs.createReadStream('public/empty.png').pipe(fs.createWriteStream(pat+'/'+viewid+'.png'));
      const req = proto.request(options, res => {
        res.on('data', function(chunk) {
          imgdata.push(chunk)
        })
        res.on('end', function() {
          try {
            fs.writeFileSync(pat+'/'+viewid+'.png', imgdata.read());
            resolve();
          } catch (error) {
            fs.createReadStream('public/empty.png').pipe(fs.createWriteStream(pat+'/'+viewid+'.png'));
            console.log("error ",error)
            resolve();
          }
        })

      })
      req.end()
    })
}
function getFolder(pat){
  if (!fs.existsSync("public/"+ pat)) {
    fs.mkdirSync("public/"+pat);
  }
  return "public/"+pat;
}
function dumpViewPics(protocol,port,token,host,site,project){
  return new Promise(async (resolve, reject)=>{
    var vs=await getViewsPerWorkbook(protocol,port,token,host,site,project);
    views=vs.views;
    var existing=[];
    var mypath=getFolder(site+ hashCode(project));
    fs.readdir(mypath, (err, files) => {
      files.forEach(file => {
        existing.push(file)
      });
      var missingViews = []
      if(views)
        missingViews=views.filter(function(val) {
          var found=false;
          existing.map((ff)=>{
            if(ff.indexOf(val.id)!=-1)
              found=true;
          })
          return !found;
        });
      var allImg=[];
      if(missingViews)
        missingViews.map((v)=>{
          allImg.push(getImage(protocol,port,token,host,site,mypath,v.id,v.wid));
          console.log(v.id, "thumbnail has been added!")
        })
      Promise.all(allImg).then(()=>{
        resolve(views);
      })
      var extraFiles = []
      if(views){
        extraFiles= existing.filter(function(val) {
          var isThere=true;
          views.map((vv)=>{
            if(val.indexOf(vv.id)!=-1){
              isThere= false
              return;
            }
              
          })
          return isThere;
        });
        extraFiles.map((del)=>{
          try {
            //fs.unlinkSync(mypath+del);
            console.log(del,"thumbnail has been deleted!")
          } catch(err) {
            console.error(err)
          }
        })
      }

    });
  })
}
function getProjects(protocol,port,token, host,siteid) {
  return new Promise((resolve, reject)=>{
    optionspath = encodeURI("/api/3.9/sites/" + siteid + "/projects?pageSize="+PAGE_SIZE);
    var xmldata = "";
    const https = require('https');
    const options = {
      hostname: host,
      port: port,
      path: optionspath,
      method: 'GET',
      headers: {
        'x-tableau-auth': token
      }
    }
    var proto=protocol=="https"?https:http;
    const req = proto.request(options, res => {
      res.on('data', function(chunk) {
        xmldata += chunk;
      })
      res.on('end', function() {
        var parser = new xml2js.Parser();
        parser.parseString(xmldata, function(err, parsedXml) {
          if(parsedXml.tsResponse.projects){
            var res = parsedXml.tsResponse.projects;
            resolve (res);
          }
          else{
            resolve (null);
          }
          });
      })
    })
    req.end()
  })
}
function getProject(protocol,port,token, host,siteid, projectName) {
  return new Promise((resolve, reject)=>{
    optionspath = encodeURI("/api/3.9/sites/" + siteid + "/projects?pageSize="+PAGE_SIZE);
    var xmldata = "";
    const https = require('https');
    const options = {
      hostname: host,
      port: port,
      path: optionspath,
      method: 'GET',
      headers: {
        'x-tableau-auth': token
      }
    }
    var proto=protocol=="https"?https:http;
    const req = proto.request(options, res => {
      res.on('data', function(chunk) {
        xmldata += chunk;
      })
      res.on('end', function() {
        var parser = new xml2js.Parser();
        parser.parseString(xmldata, function(err, parsedXml) {
          if(parsedXml.tsResponse.projects){
            var res = parsedXml.tsResponse.projects[0].project;
            var id=null
            res.map((p)=>{
              if(p.$.name.toLowerCase()==projectName.toLowerCase())
                id=p.$.id;
            })
            resolve (id);
          }
          else{
            resolve (null);
          }
          });
      })
    })
    req.end()
  })
}
function getViews(protocol,port,token,host,siteid,projectID,pageNumber) {
  return new Promise((resolve, reject)=>{
    var vs=[];
    optionspath = encodeURI("/api/3.9/sites/" + siteid + "/views?pageSize="+PAGE_SIZE+"&pageNumber="+pageNumber);
    var xmldata = "";
    const https = require('https');
    const options = {
      hostname: host,
      port: port,
      path: optionspath,
      method: 'GET',
      headers: {
        'x-tableau-auth': token
      }
    }
    var proto=protocol=="https"?https:http;
    const req = proto.request(options, res => {
      res.on('data', function(chunk) {
        xmldata += chunk;
      })
      res.on('end', function() {
        var parser = new xml2js.Parser();
        parser.parseString(xmldata, function(err, parsedXml) {
          if(parsedXml.tsResponse.views){
            var res = parsedXml.tsResponse.views[0].view;
            if(res)
              res.map((v)=>{
                if(projectID && v.$ && v.project[0].$.id==projectID){
                  vs.push({"id":v.$.id,"wid":v.workbook[0].$.id,"name":v.$.name,"url":v.$.contentUrl});
                }
              })
            resolve ({views:vs,retrieved:res.length,total:parsedXml.tsResponse.pagination?parsedXml.tsResponse.pagination[0].$.totalAvailable:0});
          }
          else{
            console.log("err in getviews",projectID);
            resolve (null);
          }
        });
      })
    })
    req.end()
  })
}
function getWorkbooks(protocol,port,token,host,siteid,projectID,pageNumber) {
  return new Promise((resolve, reject)=>{
    var wkb=[];
    optionspath = encodeURI("/api/3.9/sites/" + siteid + "/workbooks?pageSize="+PAGE_SIZE+"&pageNumber="+pageNumber);
    var xmldata = "";
    const https = require('https');
    const options = {
      hostname: host,
      port: port,
      path: optionspath,
      method: 'GET',
      headers: {
        'x-tableau-auth': token
      }
    }
    var proto=protocol=="https"?https:http;
    const req = proto.request(options, res => {
      res.on('data', function(chunk) {
        xmldata += chunk;
      })
      res.on('end', function() {
        var parser = new xml2js.Parser();
        parser.parseString(xmldata, function(err, parsedXml) {
           if(parsedXml.tsResponse && parsedXml.tsResponse.workbooks){
            var res = parsedXml.tsResponse.workbooks[0].workbook;
            if(res)
              res.map((w)=>{
                if(projectID && w.$ && w.project && w.project[0] && w.project[0].$.id==projectID){
                  wkb.push({"id":w.$.id,"pid":w.project[0].$.id,"name":w.$.name,"url":w.$.contentUrl,"showTabs":w.$.showTabs});
                }
              })
            resolve ({workbooks:wkb,retrieved:res.length,total:parsedXml.tsResponse.pagination?parsedXml.tsResponse.pagination[0].$.totalAvailable:0});
          }
          else{
            console.log("err in getviews",projectID);
            resolve (null);
          }
        });
      })
    })
    req.end()
  })
}
function getViewsPerWorkbook(protocol,port,token,host,siteid,wkbid){
  return new Promise((resolve, reject)=>{
    var vs=[];
    optionspath = encodeURI("/api/3.9/sites/" + siteid + "/workbooks/" +wkbid+"/views");
    var xmldata = "";
    const https = require('https');
    const options = {
      hostname: host,
      port: port,
      path: optionspath,
      method: 'GET',
      headers: {
        'x-tableau-auth': token
      }
    }
    var proto=protocol=="https"?https:http;
    const req = proto.request(options, res => {
      res.on('data', function(chunk) {
        xmldata += chunk;
      })
      res.on('end', function() {
        var parser = new xml2js.Parser();
        parser.parseString(xmldata, function(err, parsedXml) {
          if(parsedXml.tsResponse.views){
            var res = parsedXml.tsResponse.views[0].view;
            if(res)
              res.map((v)=>{
                console.log(v);
                vs.push({"id":v.$.id,"wid":wkbid,"name":v.$.name,"url":v.$.contentUrl});
              })
            resolve ({views:vs,retrieved:res.length});
          }
          else{
            console.log("err in getviews",projectID);
            resolve (null);
          }
        });
      })
    })
    req.end()
  })
}
function authenticate(host,protocol,port,site,tokenName,tokenValue) {
  return new Promise((resolve, reject)=>{
    try {
      var xmldata = "";
      site=site.toLowerCase()=="default"?"":site;
      var postdata = `<tsRequest><credentials personalAccessTokenName='${tokenName}' personalAccessTokenSecret='${tokenValue}'><site contentUrl='${site}' /></credentials></tsRequest>`;
      var options = {
        hostname: `${host}`,
        port: port,
        path: '/api/3.9/auth/signin',
        method: 'POST',
        headers: {
          'Content-Type': 'text/json',
          'Content-Length':postdata.length
        }
      }
      var proto=protocol=="https"?https:http;
      const req = proto.request(options, res => {
        res.on('data', function(chunk) {
          xmldata += chunk;
        })
        res.on('end', function() {
          var parser = new xml2js.Parser();
          parser.parseString(xmldata, function(err, parsedXml) {
            if(parsedXml.tsResponse.credentials){
              var token = parsedXml.tsResponse.credentials[0].$.token;
              var siteid = parsedXml.tsResponse.credentials[0].site[0].$.id;
              resolve ({token:token,siteid:siteid})
            } else{
              resolve({error:parsedXml.tsResponse.error[0].summary.join(',') +' / ' +parsedXml.tsResponse.error[0].detail.join(',')})
            }
          });
        })
    })
    req.on('error', function(err) {
      resolve({error:`${err}`})
    })  
    req.write(postdata);
    req.end();
  } catch (error) {
    reject ({"error":error});
  }
  })
  
}
function copyTemplate(tpname){
  let from= __dirname + '/public/devcenter/templates/'+tpname;
  let to=Date.now().toString();
  copyFolderSync(from,to);
  return to;

}
function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) 
    fs.mkdirSync(to)
  fs.readdirSync(from).forEach(element => {
      if (fs.lstatSync(path.join(from, element)).isFile()) {
          fs.copyFileSync(path.join(from, element), path.join(to, element));
      } else {
          copyFolderSync(path.join(from, element), path.join(to, element));
      }
  });
}
function writeTofile(content,filepath){
  try {
    const data = fs.writeFileSync(filepath, content);
  } catch (err) {
    console.error(err)
  }
}
function variabilized(raw){
  let war=[];
  JSON.parse(raw).map((el)=>{
    war.push(el);
  })
  return JSON.stringify(war)
}
function generateCSS(arr){
  var css=":root {\r\n";
  arr.map((el)=>{
    css+=el.key+":"+el.val+';\r\n'
  })
  css+="}";
  return css;
}

app.use(express.static(path.join(__dirname, "/public")));

