'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');

function variables(selector){
    const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const body=css.match(new RegExp(escaped+'\\s*\\{([^}]+)\\}'))?.[1];
    assert.ok(body,`Theme palette ${selector} exists`);
    return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[a-f\d]{3,6})\s*;/gi)].map(([,key,color])=>[key,color]));
}
function luminance(color){
    let hex=color.slice(1);if(hex.length===3)hex=[...hex].map(c=>c+c).join('');
    const channels=hex.match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}
function contrast(a,b){const first=luminance(a),second=luminance(b);return(Math.max(first,second)+.05)/(Math.min(first,second)+.05);}

for(const [theme,palette] of [['light',variables(':root')],['dark',{...variables(':root'),...variables('[data-theme=dark]')}]]){
    test(`${theme} body, muted labels and coloured status surfaces meet normal-text contrast`,()=>{
        const pairs=[
            ...['bg-light','bg-page','primary-light'].flatMap(background=>[['text-dark',background],['text-muted',background]]),
            ['primary','bg-light'],['primary','bg-page'],['primary','primary-light'],['on-primary','primary'],
            ['on-accent','surface-accent'],['on-accent-muted','surface-accent'],
            ...['success','warning','danger','info','neutral','lime','peach'].map(name=>[`on-${name}`,`surface-${name}`])
        ];
        for(const [foreground,background] of pairs){
            assert.ok(palette[foreground]&&palette[background],`${theme}: ${foreground}/${background} defined`);
            const ratio=contrast(palette[foreground],palette[background]);
            assert.ok(ratio>=4.5,`${theme}: ${foreground}/${background} must be >=4.5:1, got ${ratio.toFixed(2)}:1`);
        }
    });
    test(`${theme} form-control boundaries are distinguishable from page and field surfaces`,()=>{
        for(const surface of ['bg-light','bg-page'])assert.ok(contrast(palette['control-border'],palette[surface])>=3,`${theme} control-border/${surface} must be >=3:1`);
    });
}

test('native option menus and placeholders use theme-aware foreground and background pairs',()=>{
    assert.match(css,/select option,select optgroup\s*\{[^}]*background:var\(--bg-light\)[^}]*color:var\(--text-dark\)/);
    assert.match(css,/input::placeholder,textarea::placeholder\s*\{[^}]*color:var\(--text-muted\)[^}]*opacity:1/);
    const funding=fs.readFileSync(path.join(__dirname,'../funding.css'),'utf8');
    assert.match(funding,/\.funding-call\.closed\{[^}]*background:var\(--surface-danger\)[^}]*color:var\(--on-danger\)/);
});
