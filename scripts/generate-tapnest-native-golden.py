"""Run unmodified pure motion methods from TapNest main on the JVM.
Usage: python scripts/generate-tapnest-native-golden.py TAPNEST_SOURCE KOTLINC
Only strips serialization annotations; no native motion is rewritten here.
"""
import json,pathlib,re,subprocess,sys,tempfile
source=pathlib.Path(sys.argv[1]).resolve();compiler=pathlib.Path(sys.argv[2]).resolve()
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
base={'id':'tail','image':'tail.png','bones':[{'x':.45,'y':.8},{'x':.5,'y':.56},{'x':.6,'y':.3},{'x':.57,'y':.08}],'idleSwing':True,'idleAmplitude':22,'idleSpeed':.7}
cases=[]
def case(name,**kw):cases.append({'name':name,'layer':base|kw})
case('classic-delay')
case('spring-v1',swingMode='SPRING',shapePreservation=.4)
case('spring-v2',swingMode='SPRING',springVersion=2,springSoftness=.9,springDamping=.2,shapePreservation=.75)
case('one-sided',swingMode='SPRING',springVersion=2,idleAmplitude=75,idlePlane={'enabled':True,'negativeLimit':0,'positiveLimit':3})
case('asymmetric',swingMode='SPRING',springVersion=2,idlePlane={'enabled':True,'negativeLimit':65,'positiveLimit':3})
case('outward-reflected',swingMode='SPRING',springVersion=2,swingRange='OUTWARD_ONLY',reflectedMotion=True,idleStartReversed=True)
case('tip-idle',idleScope='TIP')
case('regional-multichain',boneRegion={'right':.47},boneChains=[{'bones':[{'x':.8,'y':.8},{'x':.8,'y':.1}],'region':{'left':.55},'swingMode':'SPRING','springVersion':2,'startReversed':True,'plane':{'enabled':True,'linear':True,'axisDegrees':90}}])
case('linear-steering',swingMode='SPRING',idlePlane={'enabled':True,'linear':True,'axisDegrees':90},shapePreservation=1)
case('reverse-rotation',bones=[{'x':.2,'y':.2,'swingDirection':'ROTATION_REVERSE'},{'x':.4,'y':.6},{'x':.7,'y':.7,'swingDirection':'HORIZONTAL_REVERSE'},{'x':.8,'y':.9,'swingDirection':'FIXED'}])
case('tap-own-bones',interactionConfigured=True,tapShake=True,tapFlexible={'enabled':True,'scope':'TIP','amplitude':33,'count':3,'speed':2,'durationMs':1000},tapBones=[{'x':.4,'y':.8},{'x':.5,'y':.5},{'x':.6,'y':.2}],tapPlane={'enabled':True,'negativeLimit':15,'positiveLimit':25})
case('timed-own-chains',interactionConfigured=True,periodicEnabled=True,periodicFlexible={'enabled':True,'scope':'LOWER'},periodicBones=[],periodicBoneChains=[{'bones':base['bones'],'scope':'MIDDLE','softness':.2,'damping':.8}],periodicBoneRegion={'left':.1},periodicPlane={'enabled':True,'negativeLimit':12,'positiveLimit':30})
case('head-nod',id='head_0',bones=[],idleSwing=False)
case('head-configured',id='head_0',bones=[],idleSwing=False,interactionConfigured=True,tapShake=True,tapBasicConfigured=True,tapFlexible={'amplitude':25,'count':2,'speed':1.8,'durationMs':900},tapPlane={'enabled':True,'linear':True,'axisDegrees':90})
case('hat-pop',id='hat',bones=[],idleSwing=False,interactionConfigured=True,tapShake=True,tapMotion='HAT_POP',hatFlightHeight=.36)
case('mirrored-wing',id='wing_right',bones=[],idleSwing=True,mirrorX=True,mirroredFromId='wing_left',reflectedMotion=True,interactionConfigured=True,tapShake=True,tapMotion='FLAP')
case('periodic-basic',bones=[],idleSwing=False,interactionConfigured=True,periodicEnabled=True,periodicMotion='TWITCH',periodicBasicConfigured=True,periodicFlexible={'count':3,'amplitude':11,'durationMs':800})
# Independent controls must keep an explicit empty bone array (no legacy fallback).
case('idle-own-empty',idleBones=[],idleBoneChains=[],idleFlexibleEnabled=False,idleAmplitude=0)
float_fields=set('x y pivotX pivotY restScale idleAmplitude idleSpeed idleLagSeconds springSoftness springDamping shapePreservation hatFlightHeight periodicIntervalSeconds left top right bottom axisDegrees negativeLimit positiveLimit amplitude speed softness damping scaleX scaleY angle alpha'.split())
enum_fields={'swingDirection':'TapNestBoneSwingDirection','swingMode':'TapNestSwingMode','swingRange':'TapNestSwingRange','idleScope':'TapNestMotionScope','scope':'TapNestMotionScope','tapMotion':'TapNestPartMotion','periodicMotion':'TapNestPartMotion','periodicAction':'TapNestPeriodicAction'}
def val(k,v):
 if v is None:return 'null'
 if isinstance(v,bool):return str(v).lower()
 if isinstance(v,(int,float)):return str(float(v))+'f' if k in float_fields else str(v)+('L' if k=='durationMs' else '')
 if isinstance(v,str):return enum_fields[k]+'.'+v if k in enum_fields else json.dumps(v,ensure_ascii=False)
 if isinstance(v,list):return 'listOf('+','.join(obj('TapNestBoneChain' if 'Chains' in k else 'TapNestBonePoint',x) for x in v)+')'
 return obj('TapNestImpulse' if 'Flexible' in k else 'TapNestMotionPlane' if 'Plane' in k or k=='plane' else 'TapNestBoneRegion',v)
def obj(type,v):return type+'('+','.join(k+'='+val(k,x) for k,x in v.items())+')'
files=['TapNestMotion','TapNestLayerActions','TapNestFlexibleMesh','TapNestSpringChain','TapNestSwingBounds','TapNestPresets','TapNestSymmetry','TapNestFrames']
with tempfile.TemporaryDirectory() as temp:
 tmp=pathlib.Path(temp)
 for f in files:
  text=(source/'app/src/main/java/com/deskpet/engine'/f'{f}.kt').read_text()
  text=re.sub(r'^import kotlinx.serialization.Serializable\n','',text,flags=re.M).replace('@Serializable\n','')
  (tmp/f'{f}.kt').write_text(text)
 (tmp/'HeadMode.kt').write_text('package com.deskpet.engine\nenum class TapNestHeadMode { FULL_HEAD,BLANK_HEAD_WITH_FACE }')
 (tmp/'Stub.kt').write_text('package com.deskpet.data\nenum class CompanionAction { FEED,BATH,PLAY }')
 prefix='''package com.deskpet.engine
fun json(v:Any?):String=when(v){null->"null";is String->"\\\""+v+"\\\"";is FloatArray->v.joinToString(",","[","]");is List<*>->v.joinToString(",","[","]"){json(it)};is Map<*,*>->v.entries.joinToString(",","{","}"){json(it.key.toString())+":"+json(it.value)};else->v.toString()}
fun pose(p:TapNestPose)=listOf(p.x,p.y,p.angle,p.scaleX,p.scaleY,p.alpha)
fun runCase(name:String,layer:TapNestLayer):Map<String,Any?> {
 val all=listOf(layer);val states=mutableMapOf<String,TapNestSpringChain>();val times=listOf(0L,16L,33L,100L,150L,270L,440L,680L,900L,1000L,1800L,7000L,7160L,7320L,7680L)
 val samples=times.map { t ->
 val age=if(t>=7000L) 9999L else t
 val skin=TapNestLayerActions.skinForAction(layer,all,t,age)
 val spring=skin.idleSwing&&skin.idleFlexibleEnabled&&skin.bones.size>=2&&skin.swingMode==TapNestSwingMode.SPRING
 val idle=if(spring) states.getOrPut(skin.id){TapNestSpringChain()}.step(skin,t) else null
 val joints=TapNestLayerActions.jointAngles(skin,all,t,age,idle)
 val extra=skin.boneChains.mapIndexed { i,c -> val child=c.asLayer(skin);val ci=if(child.idleSwing&&child.idleFlexibleEnabled&&child.swingMode==TapNestSwingMode.SPRING&&child.bones.size>=2)states.getOrPut("${skin.id}#$i"){TapNestSpringChain()}.step(child,t) else null;TapNestLayerActions.jointAngles(child,all,t,age,ci) }
 val active=joints!==idle
 val verts=TapNestFlexibleMesh.vertices(if(active)skin.copy(shapePreservation=0f)else skin,120,160,t,4,joints,extra,if(spring&&!active&&skin.idlePlane.enabled&&!skin.idlePlane.linear)0f else TapNestLayerActions.activeFlexibleDriveAmplitude(skin,all,t,age))
 mapOf("t" to t,"age" to age,"vertices" to verts,"joints" to joints,"tapPose" to pose(TapNestLayerActions.motionPose(layer,age,false,160)),"periodicPose" to pose(TapNestLayerActions.motionPose(layer,(t%7000),true,160)))
 }
 return mapOf("name" to name,"samples" to samples)
}
fun main(){println(json(listOf(
'''
 (tmp/'Main.kt').write_text(prefix+',\n'.join('runCase('+json.dumps(c['name'])+','+obj('TapNestLayer',c['layer'])+')' for c in cases)+')))}')
 subprocess.run([str(compiler),*[str(p) for p in tmp.glob('*.kt')],'-include-runtime','-d',str(tmp/'golden.jar')],check=True)
 result=json.loads(subprocess.check_output(['java','-jar',str(tmp/'golden.jar')],text=True))
 for c,r in zip(cases,result):c['samples']=r['samples']
 dest=pathlib.Path('test/fixtures/tapnest-native/main-golden.json')
 dest.write_text(json.dumps({'source':'yanlue1211/TapNest','commit':commit,'generator':'scripts/generate-tapnest-native-golden.py','cases':cases},ensure_ascii=False,separators=(',',':'))+'\n')
 print(f'Wrote {len(cases)} native cases to {dest}')
